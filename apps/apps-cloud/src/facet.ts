import { DurableObject } from "cloudflare:workers";
import { Layer } from "effect";
import type { StoreDefinition, StorageIdentity } from "@tailorkit/app-storage/server";
import {
  createStorageHandler,
  Persistence,
  NotificationDelivery,
  localNotifications,
  storageError,
} from "@tailorkit/app-storage/runtime";
import type { Migration, SqlDriver } from "@tailorkit/app-storage/runtime";
import { StorageError } from "@tailorkit/app-storage";

/** Loaded only inside the installation's isolated Dynamic Worker. */
export function createStorageFacet(
  store: StoreDefinition,
  migrations: readonly Migration[],
): new (
  ctx: DurableObjectState,
  env: Record<string, never>,
) => DurableObject<Record<string, never>> & { fetch(request: Request): Promise<Response> } {
  return class StorageFacet extends DurableObject<Record<string, never>> {
    #handle: ReturnType<typeof createStorageHandler>;
    constructor(ctx: DurableObjectState, env: Record<string, never>) {
      super(ctx, env);
      const driver: SqlDriver = {
        execute: (sql, bindings = []) =>
          ctx.storage.sql.exec(sql, ...(bindings as SqlStorageValue[])).toArray(),
        transaction: (run) => ctx.storage.transactionSync(run),
      };
      this.#handle = createStorageHandler(
        store,
        migrations,
        Layer.merge(
          Layer.succeed(Persistence, driver),
          Layer.succeed(NotificationDelivery, localNotifications()),
        ),
      );
    }
    fetch(request: Request): Promise<Response> {
      try {
        // The trusted supervisor overwrites this header and strips the caller's JWT.
        const identity = JSON.parse(
          request.headers.get("x-tailorkit-identity") ?? "null",
        ) as StorageIdentity | null;
        if (!identity) {
          throw new StorageError("UNAUTHORIZED", "Missing invocation identity");
        }
        return this.#handle(request, identity);
      } catch (error) {
        const failure = storageError(error);
        return Promise.resolve(
          Response.json({ code: failure.code, message: failure.message }, { status: 401 }),
        );
      }
    }
  };
}
