import type { StandardSchemaV1 } from "@standard-schema/spec";
import { StorageError } from "../errors";
import type { StorageIdentity, StoreDefinition } from "../server";
import { databaseScope } from "./database";
import type { Invalidation, Migration, Notifications, SqlDriver } from "./driver";
import { json } from "./json";
import { assertMigrated } from "./migrations";

interface ErasedFunction {
  kind: "query" | "mutation";
  input: StandardSchemaV1;
  output: StandardSchemaV1;
  handler(
    context: { db: ReturnType<typeof databaseScope>["db"]; identity: StorageIdentity },
    input: unknown,
  ): unknown;
}
export interface Invocation {
  name: string;
  input: unknown;
  apiVersion: number;
}
export interface Snapshot {
  value: unknown;
  revision: number;
}
function synchronous(value: unknown) {
  if (value && typeof value === "object" && "then" in value) {
    // Close DB scope before any continuation can run; avoid an unhandled rejection as well.
    void Promise.resolve(value).catch(() => {});
    throw new StorageError("BAD_REQUEST", "Storage handlers and validators must be synchronous");
  }
  return value;
}
function validate(schema: StandardSchemaV1, value: unknown) {
  const result = synchronous(
    schema["~standard"].validate(value),
  ) as StandardSchemaV1.Result<unknown>;
  if (result.issues) {
    throw new StorageError("BAD_REQUEST", "Storage validation failed");
  }
  return result.value;
}
export class StorageRuntime {
  private readonly store: StoreDefinition;
  private readonly driver: SqlDriver;
  private readonly notifications: Notifications;
  constructor(
    store: StoreDefinition,
    driver: SqlDriver,
    notifications: Notifications,
    migrations: readonly Migration[],
  ) {
    this.store = store;
    this.driver = driver;
    this.notifications = notifications;
    driver.transaction(() => assertMigrated(driver, migrations, store.apiVersion));
  }
  private revision() {
    return Number(
      this.driver.execute("SELECT value FROM tk_state WHERE key = 'revision'")[0]?.value ?? 0,
    );
  }
  private definition(request: Invocation, kind: "query" | "mutation", identity: StorageIdentity) {
    if (identity.expiresAt <= Date.now()) {
      throw new StorageError("UNAUTHORIZED", "Storage token expired");
    }
    if (request.apiVersion !== this.store.apiVersion) {
      throw new StorageError("INCOMPATIBLE_VERSION", "Reload this app to use the current API");
    }
    if (!Object.hasOwn(this.store.functions as object, request.name)) {
      throw new StorageError("NOT_FOUND", "Unknown storage function");
    }
    const fn = (this.store.functions as Record<string, ErasedFunction>)[request.name];
    if (!fn) {
      throw new StorageError("NOT_FOUND", "Unknown storage function");
    }
    if (fn.kind !== kind) {
      throw new StorageError("BAD_REQUEST", "Wrong storage function kind");
    }
    return fn;
  }
  private run(
    fn: ErasedFunction,
    input: unknown,
    identity: StorageIdentity,
    reads: Set<string>,
    writes: Set<string>,
  ) {
    const scope = databaseScope(
      this.store.schema,
      this.driver,
      fn.kind === "mutation",
      reads,
      writes,
    );
    try {
      const output = synchronous(
        fn.handler({ db: scope.db, identity: Object.freeze({ ...identity }) }, input),
      );
      return JSON.parse(json(validate(fn.output, output))) as unknown;
    } finally {
      scope.close();
    }
  }
  query(request: Invocation, identity: StorageIdentity) {
    const fn = this.definition(request, "query", identity);
    const input = validate(fn.input, request.input);
    const reads = new Set<string>();
    const snapshot = this.driver.transaction(() => ({
      value: this.run(fn, input, identity, reads, new Set()),
      revision: this.revision(),
    }));
    return { ...snapshot, reads };
  }
  mutate(request: Invocation & { requestId: string }, identity: StorageIdentity): unknown {
    const fn = this.definition(request, "mutation", identity);
    const input = validate(fn.input, request.input);
    const fingerprint = json({ apiVersion: request.apiVersion, name: request.name, input });
    const key = json([identity.userId, request.requestId]);
    let change: Invalidation | undefined;
    const value = this.driver.transaction(() => {
      const receipt = this.driver.execute(
        "SELECT fingerprint, result FROM tk_receipts WHERE key = ?",
        [key],
      )[0];
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) {
          throw new StorageError("CONFLICT", "Mutation request ID was reused with different input");
        }
        return JSON.parse(String(receipt.result)) as unknown;
      }
      const writes = new Set<string>();
      const result = this.run(fn, input, identity, new Set(), writes);
      if (writes.size) {
        const revision = this.revision() + 1;
        this.driver.execute(
          "INSERT INTO tk_state (key, value) VALUES ('revision', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [revision],
        );
        change = { revision, tables: [...writes] };
      }
      this.driver.execute("INSERT INTO tk_receipts (key, fingerprint, result) VALUES (?, ?, ?)", [
        key,
        fingerprint,
        json(result),
      ]);
      return result;
    });
    // Notification failure must never turn an accepted write into a failed mutation.
    if (change) {
      try {
        this.notifications.publish(change);
      } catch {
        // A future remote delivery adapter must use a durable outbox/revision reconciliation.
        console.error("Storage notification delivery failed after commit", {
          revision: change.revision,
        });
      }
    }
    return value;
  }
  subscribe(
    request: Invocation,
    identity: StorageIdentity,
    signal?: AbortSignal,
  ): AsyncIterableIterator<Snapshot> {
    let dependencies = new Set<string>();
    let latest: Snapshot | undefined;
    let failure: unknown;
    let stopped = false;
    let wake: (() => void) | undefined;
    const rerun = () => {
      try {
        const result = this.query(request, identity);
        dependencies = result.reads; // Replace, including dependencies dropped by conditional reads.
        latest = { value: result.value, revision: result.revision };
      } catch (error) {
        failure = error;
      }
      wake?.();
    };
    // Register and run synchronously: no commit can land between the initial read and registration.
    const unlisten = this.notifications.listen((change) => {
      if (change.tables.some((table) => dependencies.has(table))) {
        rerun();
      }
    });
    const close = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      unlisten();
      clearTimeout(expiry);
      signal?.removeEventListener("abort", close);
      wake?.();
    };
    const expiry = setTimeout(
      () => {
        failure = new StorageError("UNAUTHORIZED", "Subscription token expired");
        close();
      },
      Math.max(0, identity.expiresAt - Date.now()),
    );
    signal?.addEventListener("abort", close, { once: true });
    if (signal?.aborted) {
      close();
    } else {
      rerun();
    }
    const waitForChange = () =>
      new Promise<void>((resolve) => {
        wake = resolve;
      });
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        while (true) {
          if (latest || failure || stopped) {
            break;
          }
          await waitForChange();
        }
        wake = undefined;
        if (failure) {
          close();
          throw failure;
        }
        if (stopped) {
          return { done: true, value: undefined };
        }
        const value = latest;
        if (!value) {
          return { done: true, value: undefined };
        }
        latest = undefined;
        return { done: false, value };
      },
      return() {
        close();
        return Promise.resolve({ done: true as const, value: undefined });
      },
    };
  }
}
