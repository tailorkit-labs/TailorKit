import type { WriteDatabase } from "../schema";
// Test fixtures use promise-shaped callbacks and assertions on known fixture values.
/* eslint-disable require-await, typescript/no-non-null-assertion, unicorn/no-await-expression-member */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { Layer } from "effect";
import { createFunctions, defineSchema, defineStore, fields, StorageError } from "../server";
import type { StorageIdentity, StoreDefinition } from "../server";
import { readMigrations } from "../tooling";
import { localNotifications } from "./driver";
import type { Migration, Notifications, SqlDriver } from "./driver";
import { StorageRuntime } from "./runtime";
import { migrate } from "./migrations";
import { createStorageHandler, Persistence, NotificationDelivery } from "../runtime";
import { createStorageClient } from "../client";
import { functionReference } from "../reference";

const migrations = await readMigrations(
  fileURLToPath(
    new URL("../../../../examples/apps/persistent-todo/storage/migrations", import.meta.url),
  ),
);
const schema = defineSchema({
  todos: { id: fields.text({ primaryKey: true }), text: fields.text(), done: fields.boolean() },
});
const { query, mutation } = createFunctions(schema);
const row = z.object({ id: z.string(), text: z.string(), done: z.boolean() });
const identity: StorageIdentity = {
  userId: "user-1",
  appId: "test",
  installationId: "install-1",
  expiresAt: Date.now() + 60_000,
};
const request = (name: string, input: unknown = {}) => ({ name, input, apiVersion: 1 });
const mutationRequest = (name: string, input: unknown = {}, requestId = crypto.randomUUID()) => ({
  ...request(name, input),
  requestId,
});
const connections: DatabaseSync[] = [];
function fixture(
  custom: Record<string, unknown> = {},
  notifications: Notifications = localNotifications(),
  suppliedMigrations = migrations,
) {
  const sqlite = new DatabaseSync(":memory:");
  connections.push(sqlite);
  const driver: SqlDriver = {
    execute(sql, bindings = []) {
      const statement = sqlite.prepare(sql);
      return statement.all(...(bindings as (null | number | string)[])) as Record<
        string,
        unknown
      >[];
    },
    transaction(run) {
      sqlite.exec("BEGIN");
      try {
        const result = run();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const store: StoreDefinition = defineStore({
    schema,
    apiVersion: 1,
    functions: {
      list: query({
        input: z.object({}),
        output: z.array(row),
        handler: ({ db }) => db.table("todos").all(),
      }),
      add: mutation({
        input: row,
        output: row,
        handler: ({ db }, input) => db.table("todos").insert(input),
      }),
      ...custom,
    },
  });
  migrate(driver, suppliedMigrations, store.apiVersion);
  return {
    runtime: new StorageRuntime(store, driver, notifications, suppliedMigrations),
    store,
    driver,
    sqlite,
    notifications,
  };
}
afterEach(() => {
  for (const db of connections.splice(0)) {
    db.close();
  }
  vi.useRealTimers();
});
describe("persistent runtime", () => {
  it("executes generated migrations once, preserves data, and refuses edited or older history", () => {
    const { runtime, store, driver } = fixture();
    runtime.mutate(mutationRequest("add", { id: "1", text: "persisted", done: false }), identity);
    expect(
      new StorageRuntime(store, driver, localNotifications(), migrations).query(
        request("list"),
        identity,
      ).value,
    ).toEqual([{ id: "1", text: "persisted", done: false }]);
    expect(() => new StorageRuntime(store, driver, localNotifications(), [])).toThrow("newer");
    expect(
      () =>
        new StorageRuntime(store, driver, localNotifications(), [
          { ...migrations[0]!, hash: "modified" },
        ]),
    ).toThrow("modified");
  });
  it("rolls back a failing migration, including its journal record", () => {
    const { driver, store, sqlite } = fixture();
    const broken: Migration = {
      id: "later",
      hash: "broken",
      statements: ["CREATE TABLE migration_probe (id TEXT)", "INVALID SQL"],
    };
    // Deliberately malformed migration fixture, not a generated production migration.
    expect(() => migrate(driver, [...migrations, broken], store.apiVersion)).toThrow();
    expect(
      sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'migration_probe'").all(),
    ).toEqual([]);
    expect(sqlite.prepare("SELECT id FROM tk_migrations").all()).toHaveLength(migrations.length);
  });
  it("commits a mutation receipt atomically and rejects reuse with different input", () => {
    const { runtime, driver, store } = fixture();
    const accepted = mutationRequest("add", { id: "1", text: "once", done: false });
    expect(runtime.mutate(accepted, identity)).toEqual(runtime.mutate(accepted, identity));
    const restarted = new StorageRuntime(store, driver, localNotifications(), migrations);
    expect(restarted.mutate(accepted, identity)).toEqual({ id: "1", text: "once", done: false });
    expect(restarted.query(request("list"), identity).value).toHaveLength(1);
    expect(() =>
      runtime.mutate({ ...accepted, input: { id: "2", text: "different", done: true } }, identity),
    ).toThrow("reused");
  });
  it("rolls back writes and receipts on handler or output validation failure", () => {
    const { runtime, sqlite } = fixture({
      fail: mutation({
        input: row,
        output: row,
        handler: ({ db }, input) => {
          db.table("todos").insert(input);
          throw new StorageError("BAD_REQUEST", "fail");
        },
      }),
      invalidOutput: mutation({
        input: row,
        output: z.string(),
        handler: ({ db }, input) => {
          db.table("todos").insert(input);
          return 1 as never;
        },
      }),
    });
    for (const name of ["fail", "invalidOutput"]) {
      expect(() =>
        runtime.mutate(
          mutationRequest(name, { id: name, text: "rollback", done: false }),
          identity,
        ),
      ).toThrow();
    }
    expect(runtime.query(request("list"), identity).value).toEqual([]);
    expect(sqlite.prepare("SELECT * FROM tk_receipts").all()).toEqual([]);
  });
  it("rejects writes from queries, async handlers, and escaped database scopes", async () => {
    let escaped: (() => unknown) | undefined;
    const { runtime } = fixture({
      writeQuery: query({
        input: z.object({}),
        output: z.null(),
        handler: ({ db }) => {
          (db as WriteDatabase<typeof schema>)
            .table("todos")
            .insert({ id: "bad", text: "bad", done: false });
          return null;
        },
      }),
      escape: mutation({
        input: z.object({}),
        output: z.null(),
        handler: ({ db }) => {
          escaped = () => db.table("todos").insert({ id: "escape", text: "bad", done: false });
          return null;
        },
      }),
      asyncWrite: {
        kind: "mutation",
        input: z.object({}),
        output: z.null(),
        handler: async ({ db }: { db: WriteDatabase<typeof schema> }) => {
          db.table("todos").insert({ id: "before-await", text: "bad", done: false });
          await Promise.resolve();
          db.table("todos").insert({ id: "after-await", text: "bad", done: false });
          return null;
        },
      },
    });
    expect(() => runtime.query(request("writeQuery"), identity)).toThrow("cannot write");
    runtime.mutate(mutationRequest("escape"), identity);
    expect(escaped).toBeDefined();
    expect(escaped!).toThrow("scope has ended");
    expect(() => runtime.mutate(mutationRequest("asyncWrite"), identity)).toThrow("synchronous");
    await Promise.resolve();
    expect(runtime.query(request("list"), identity).value).toEqual([]);
  });
  it("checks API versions and identity expiry before invoking functions", () => {
    const { runtime } = fixture();
    expect(() => runtime.query({ ...request("list"), apiVersion: 2 }, identity)).toThrow(
      "current API",
    );
    expect(() => runtime.query(request("list"), { ...identity, expiresAt: 0 })).toThrow("expired");
    expect(() => runtime.query(request("add"), identity)).toThrow("kind");
  });
  it("publishes only after commit, skips failed/zero-row writes, and keeps accepted writes on delivery failure", () => {
    const notifications = {
      listen: () => () => {},
      publish: vi.fn(() => {
        throw new Error("delivery outage");
      }),
    };
    const { runtime, sqlite } = fixture(
      {
        noop: mutation({
          input: z.object({}),
          output: z.number(),
          handler: ({ db }) => db.table("todos").update({ id: "missing" }, { done: true }),
        }),
      },
      notifications,
    );
    runtime.mutate(mutationRequest("noop"), identity);
    expect(notifications.publish).not.toHaveBeenCalled();
    expect(
      runtime.mutate(mutationRequest("add", { id: "1", text: "accepted", done: false }), identity),
    ).toEqual({ id: "1", text: "accepted", done: false });
    expect(sqlite.prepare("SELECT * FROM todos").all()).toHaveLength(1);
    expect(notifications.publish).toHaveBeenCalledWith({ revision: 1, tables: ["todos"] });
  });
  it("registers before initial snapshot, coalesces updates, replaces dependencies, and cleans up subscriptions", async () => {
    let readsTodos = true;
    let runs = 0;
    const notifications = localNotifications();
    const listen = vi.spyOn(notifications, "listen");
    const { runtime } = fixture(
      {
        conditional: query({
          input: z.object({}),
          output: z.array(row),
          handler: ({ db }) => {
            runs++;
            return readsTodos ? db.table("todos").all() : [];
          },
        }),
      },
      notifications,
    );
    const stream = runtime.subscribe(request("conditional"), identity);
    notifications.publish({ revision: 100, tables: ["unrelated"] });
    expect(runs).toBe(1);
    runtime.mutate(mutationRequest("add", { id: "1", text: "setup race", done: false }), identity);
    expect((await stream.next()).value).toEqual({
      value: [{ id: "1", text: "setup race", done: false }],
      revision: 1,
    });
    readsTodos = false;
    runtime.mutate(
      mutationRequest("add", { id: "2", text: "drops dependency", done: false }),
      identity,
    );
    expect((await stream.next()).value).toEqual({ value: [], revision: 2 });
    runtime.mutate(mutationRequest("add", { id: "3", text: "no rerun", done: false }), identity);
    expect(runs).toBe(3);
    await stream.return!();
    expect(listen).toHaveBeenCalledTimes(1);
    expect((await stream.next()).done).toBe(true);
    // Reconnect uses a fresh snapshot rather than replaying a possibly missed notification.
    const reconnected = runtime.subscribe(request("list"), identity);
    expect((await reconnected.next()).value?.value).toHaveLength(3);
    await reconnected.return!();
  });
  it("ends subscription authorization at token expiry even without writes", async () => {
    vi.useFakeTimers();
    const { runtime } = fixture();
    const stream = runtime.subscribe(request("list"), { ...identity, expiresAt: Date.now() + 10 });
    await stream.next();
    const next = stream.next();
    const rejection = expect(next).rejects.toThrow("expired");
    await vi.advanceTimersByTimeAsync(11);
    await rejection;
  });
  it("round-trips queries, mutations and subscriptions over actual oRPC v2 HTTP/SSE", async () => {
    const { store, driver, notifications } = fixture();
    const handle = createStorageHandler(
      store,
      migrations,
      Layer.merge(
        Layer.succeed(Persistence, driver),
        Layer.succeed(NotificationDelivery, notifications),
      ),
    );
    const client = createStorageClient({
      getSession: async () => ({
        token: "host-owned",
        expiresAt: Date.now() + 30_000,
        url: "https://storage.test/rpc",
      }),
      fetch: async (url, init) => {
        const request = new Request(url, init);
        expect(request.headers.get("authorization")).toBe("Bearer host-owned");
        return handle(request, identity);
      },
    });
    const list = functionReference<"query", Record<string, never>, z.infer<typeof row>[]>(
      "list",
      "query",
      1,
    );
    const add = functionReference<"mutation", z.infer<typeof row>, z.infer<typeof row>>(
      "add",
      "mutation",
      1,
    );
    const values: unknown[] = [];
    const stop = client.subscribe(list, {}, (value) => values.push(value));
    await vi.waitFor(() => expect(values).toEqual([[]]));
    await client.mutate(add, { id: "wire", text: "v2", done: true });
    await vi.waitFor(() => expect(values.at(-1)).toEqual([{ id: "wire", text: "v2", done: true }]));
    expect(await client.query(list, {})).toEqual(values.at(-1));
    stop();
  });
});
