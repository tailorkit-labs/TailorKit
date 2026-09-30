import { DurableObject } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import type { StoreDefinition, StorageIdentity } from "./server";
import type { Migration, SqlDriver } from "./internal/driver";
import { localNotifications } from "./internal/driver";
import { migrate } from "./internal/migrations";
import { storageRpcHandler } from "./internal/transport";
import { StorageError, storageError } from "./errors";
import { Execution, Persistence, NotificationDelivery, executionLayer } from "./orchestration";

/** Loaded only inside the installation's untrusted Dynamic Worker, never in the supervisor. */
export function createStorageFacet(
  store: StoreDefinition,
  migrations: readonly Migration[],
): new (
  ctx: DurableObjectState,
  env: Record<string, never>,
) => DurableObject<Record<string, never>> & { fetch(request: Request): Promise<Response> } {
  return class StorageFacet extends DurableObject<Record<string, never>> {
    #driver: SqlDriver;
    #handler: ReturnType<typeof storageRpcHandler> | undefined;
    #notifications = localNotifications();
    constructor(ctx: DurableObjectState, env: Record<string, never>) {
      super(ctx, env);
      this.#driver = {
        execute: (sql, bindings = []) =>
          ctx.storage.sql.exec(sql, ...(bindings as SqlStorageValue[])).toArray(),
        transaction: (run) => ctx.storage.transactionSync(run),
      };
    }
    async fetch(request: Request): Promise<Response> {
      try {
        // The supervisor overwrites this header and never forwards the caller's JWT.
        const identity = JSON.parse(
          request.headers.get("x-tailorkit-identity") ?? "null",
        ) as StorageIdentity | null;
        if (!identity || identity.expiresAt <= Date.now()) {
          throw new StorageError("UNAUTHORIZED", "Expired invocation");
        }
        if (new URL(request.url).pathname === "/_tailorkit/migrate") {
          // CLI invokes this only after the supervisor verifies a separate migration token.
          migrate(this.#driver, migrations, store.apiVersion);
          this.#handler = undefined;
          return Response.json({
            apiVersion: store.apiVersion,
            migrations: migrations.map(({ id, hash }) => ({ id, hash })),
          });
        }
        if (!this.#handler) {
          const dependencies = Layer.merge(
            Layer.succeed(Persistence, this.#driver),
            Layer.succeed(NotificationDelivery, this.#notifications),
          );
          const runtime = Effect.runSync(
            Effect.gen(function* runtime() {
              return yield* Execution;
            }).pipe(
              Effect.provide(executionLayer(store, migrations).pipe(Layer.provide(dependencies))),
            ),
          );
          this.#handler = storageRpcHandler(runtime);
        }
        const result = await this.#handler.handle(request, {
          prefix: "/rpc",
          context: { identity, signal: request.signal },
        });
        return result.response ?? new Response("Not found", { status: 404 });
      } catch (error) {
        const failure = storageError(error);
        return Response.json(
          { code: failure.code, message: failure.message },
          {
            status:
              (
                { INCOMPATIBLE_VERSION: 409, UNAUTHORIZED: 401 } as Partial<
                  Record<typeof failure.code, number>
                >
              )[failure.code] ?? 500,
          },
        );
      }
    }
  };
}
/** Serializable build metadata. Validators and handlers stay in the isolated worker. */
export function describeStore(store: StoreDefinition) {
  return {
    schema: store.schema,
    apiVersion: store.apiVersion,
    functions: Object.fromEntries(
      Object.entries(store.functions as Record<string, { kind: string }>).map(([name, fn]) => [
        name,
        { kind: fn.kind },
      ]),
    ),
  };
}
