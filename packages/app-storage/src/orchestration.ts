// Effect service tags are kept together as the provider integration contract.
/* eslint-disable max-classes-per-file */
/** Provider integration only. Effect never appears in the app/client API. */
import { Context, Effect, Layer } from "effect";
import type { StorageIdentity, StoreDefinition } from "./server";
import type { StorageError } from "./errors";
import { storageError } from "./errors";
import type { Migration, Notifications, SqlDriver } from "./internal/driver";
import { StorageRuntime } from "./internal/runtime";

export class Persistence extends Context.Service<Persistence, SqlDriver>()(
  "tailorkit/storage/Persistence",
) {}
export class NotificationDelivery extends Context.Service<NotificationDelivery, Notifications>()(
  "tailorkit/storage/NotificationDelivery",
) {}
export class Execution extends Context.Service<Execution, StorageRuntime>()(
  "tailorkit/storage/Execution",
) {}
export function executionLayer(store: StoreDefinition, migrations: readonly Migration[]) {
  return Layer.effect(
    Execution,
    Effect.gen(function* createExecution() {
      const driver = yield* Persistence;
      const notifications = yield* NotificationDelivery;
      // Construct synchronously. No Effect fiber or async work runs inside a SQLite transaction.
      return yield* Effect.try({
        try: () => new StorageRuntime(store, driver, notifications, migrations),
        catch: storageError,
      });
    }),
  );
}
export class Authentication extends Context.Service<
  Authentication,
  {
    verify(request: Request, migration: boolean): Effect.Effect<StorageIdentity, StorageError>;
  }
>()("tailorkit/storage/Authentication") {}
export class InstallationRouting extends Context.Service<
  InstallationRouting,
  {
    forward(
      request: Request,
      identity: StorageIdentity,
      migration: boolean,
    ): Effect.Effect<Response, StorageError>;
  }
>()("tailorkit/storage/InstallationRouting") {}
export function dispatch(request: Request, migration: boolean) {
  return Effect.gen(function* dispatchRequest() {
    const auth = yield* Authentication;
    const routing = yield* InstallationRouting;
    const identity = yield* auth.verify(request, migration);
    return yield* routing.forward(request, identity, migration);
  });
}
