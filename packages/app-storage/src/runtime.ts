/** Private provider integration. No platform APIs or app-facing Effect requirements. */
import { Effect, Layer } from "effect";
import type { StorageIdentity, StoreDefinition } from "./server";
import type { Migration } from "./internal/driver";
import { migrate } from "./internal/migrations";
import { storageRpcHandler } from "./internal/transport";
import { StorageError, storageError } from "./errors";
import { Execution, Persistence, NotificationDelivery, executionLayer } from "./orchestration";

export { localNotifications } from "./internal/driver";
export { storageError } from "./errors";
export type { Migration, SqlDriver, Notifications } from "./internal/driver";
export { Execution, Persistence, NotificationDelivery, executionLayer } from "./orchestration";

/** Serialized app code is data to a trusted runtime, never a live module there. */
export interface StorageArtifact {
  readonly code: string;
  readonly codeHash: string;
  readonly apiVersion: number;
  readonly migrations: readonly { readonly id: string; readonly hash: string }[];
}

/** Adapters supply synchronous persistence and separate, ordered notifications. */
export function createStorageHandler(
  store: StoreDefinition,
  migrations: readonly Migration[],
  dependencies: Layer.Layer<Persistence | NotificationDelivery>,
) {
  let handler: ReturnType<typeof storageRpcHandler> | undefined;
  return (request: Request, identity: StorageIdentity): Promise<Response> =>
    Effect.runPromise(
      Effect.gen(function* handleStorageRequest() {
        if (identity.expiresAt <= Date.now()) {
          return yield* Effect.fail(new StorageError("UNAUTHORIZED", "Expired invocation"));
        }
        if (new URL(request.url).pathname === "/_tailorkit/migrate") {
          const driver = yield* Persistence;
          // This entire database operation is synchronous; no fiber yields inside the transaction.
          yield* Effect.try({
            try: () => migrate(driver, migrations, store.apiVersion),
            catch: storageError,
          });
          handler = undefined;
          return Response.json({
            apiVersion: store.apiVersion,
            migrations: migrations.map(({ id, hash }) => ({ id, hash })),
          });
        }
        if (!handler) {
          const runtime = yield* Effect.gen(function* getExecution() {
            return yield* Execution;
          }).pipe(Effect.provide(executionLayer(store, migrations)));
          handler = storageRpcHandler(runtime);
        }
        const active = handler;
        const result = yield* Effect.tryPromise({
          try: () =>
            active.handle(request, {
              prefix: "/rpc",
              context: { identity, signal: request.signal },
            }),
          catch: storageError,
        });
        return result.response ?? new Response("Not found", { status: 404 });
      }).pipe(
        Effect.provide(dependencies),
        Effect.catch((failure) =>
          Effect.succeed(
            Response.json(
              { code: failure.code, message: failure.message },
              {
                status:
                  failure.code === "UNAUTHORIZED"
                    ? 401
                    : failure.code === "INCOMPATIBLE_VERSION"
                      ? 409
                      : 500,
              },
            ),
          ),
        ),
      ),
    );
}

/** Validators and server implementations stay in the isolated execution boundary. */
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
