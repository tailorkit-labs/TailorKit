import { appRuntimeIssuer, bearerToken } from "@tailorkit/api-utils/app-auth";
import { AppError } from "@tailorkit/app/server";
import type { Identity } from "@tailorkit/app/server";
import { appError, resultEffect } from "./runtime/errors";
import type { Invocation } from "@tailorkit/app/protocol";
import { DurableObject } from "cloudflare:workers";
import { createInstallationHandler, rpcErrorResponse, requestRoute } from "./transport";
import { createSubscriptions } from "./supervisor/subscriptions";
import { abortable, cancellationStream } from "./runtime/cancellation";
import type { Installation } from "./transport";
import { Effect, Semaphore } from "effect";
import { ActionCapability, createActionLeases } from "./supervisor/actions";
import bootstrap from "../.generated/bootstrap.txt";
import { verifier } from "./supervisor/auth";
import type { AppFacet } from "./dynamic-workers/facet";
import { deploymentSource, installationName } from "./supervisor/source";
import type { ServerDeployment } from "./supervisor/source";

/** Trusted supervisor. The fixed facet name preserves SQLite when its code changes. */
export class AppInstallation extends DurableObject<Env> {
  #http = createInstallationHandler();
  #queue = Semaphore.makeUnsafe(1);
  #actions = createActionLeases();
  #verify = verifier(this.env);
  #source = deploymentSource(this.env);

  #subscriptions = createSubscriptions(
    this.ctx,
    (input, identity) =>
      this.#databaseQuery(input, identity).pipe(
        Effect.flatMap((result) =>
          resultEffect(result.result).pipe(
            Effect.map((value) => ({ value, tables: result.tables })),
          ),
        ),
      ),
    this.#queue,
  );

  fetch(request: Request): Promise<Response> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const token = yield* Effect.try({ try: () => bearerToken(request), catch: appError });
        const identity = yield* this.#verify(token);
        yield* Effect.try({
          try: () => {
            const expected = this.env.STORES.idFromName(
              installationName(identity, appRuntimeIssuer(this.env.PLATFORM_URL)),
            );
            if (!this.ctx.id.equals(expected)) {
              throw new AppError("FORBIDDEN", "Installation mismatch");
            }
          },
          catch: appError,
        });
        const route = requestRoute(request);
        if (!route) {
          return yield* Effect.fail(new AppError("NOT_FOUND", "Unknown RPC route"));
        }
        if (route === "subscriptions") {
          yield* this.#source.current(
            identity,
            this.ctx.storage.kv.get<string>("version")?.split(":")[0],
          );
          return yield* Effect.tryPromise({
            try: () => this.#subscriptions.open(identity),
            catch: appError,
          });
        }
        const { matched, response } = yield* Effect.tryPromise({
          try: () =>
            this.#http.handle(request, {
              prefix: "/rpc",
              context: { installation: this.#operations(identity, token, request.signal) },
            }),
          catch: appError,
        });
        if (matched) {
          return response;
        }
        return yield* Effect.fail(new AppError("NOT_FOUND", "Unknown RPC route"));
      }).pipe(
        Effect.mapError(appError),
        Effect.catch((error) => Effect.succeed(rpcErrorResponse(error))),
      ),
    );
  }

  #operations(identity: Identity, token: string, signal?: AbortSignal): Installation {
    return {
      query: (input) =>
        this.#query(input, identity).pipe(Effect.flatMap((result) => resultEffect(result.result))),
      mutate: (input) =>
        this.#mutate(input, identity).pipe(Effect.flatMap((result) => resultEffect(result.result))),
      action: (input, callSignal) =>
        this.#action(input, identity, token, signal ?? callSignal).pipe(
          Effect.flatMap((result) => resultEffect(result.result)),
        ),
    };
  }

  #facet(identity: Identity) {
    return Effect.gen({ self: this }, function* facet() {
      const deployment = yield* this.#source.current(
        identity,
        this.ctx.storage.kv.get<string>("version")?.split(":")[0],
      );
      return (yield* this.#prepareFacet(deployment, identity)).facet;
    });
  }

  #databaseQuery(input: Invocation, identity: Identity) {
    return this.#facet(identity).pipe(
      Effect.flatMap((facet) =>
        Effect.tryPromise({
          try: () => facet.query(input, identity),
          catch: appError,
        }),
      ),
    );
  }

  #query(input: Invocation, identity: Identity) {
    return this.#queue.withPermits(1)(this.#databaseQuery(input, identity));
  }

  #mutate(input: Invocation & { requestId: string }, identity: Identity) {
    return this.#queue.withPermits(1)(
      Effect.gen({ self: this }, function* mutation() {
        const facet = yield* this.#facet(identity);
        const result = yield* Effect.tryPromise({
          try: () => facet.mutate(input, identity),
          catch: appError,
        });
        if (result.committed && result.tables.length) {
          yield* this.#refresh(result.tables, facet);
        }
        return result;
      }),
    );
  }

  #refresh(tables: string[], facet: Pick<AppFacet, "query">) {
    return this.#subscriptions.refresh(tables, (input, subscriber) =>
      Effect.tryPromise({ try: () => facet.query(input, subscriber), catch: appError }).pipe(
        Effect.flatMap((result) =>
          resultEffect(result.result).pipe(
            Effect.map((value) => ({ value, tables: result.tables })),
          ),
        ),
      ),
    );
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    return this.#subscriptions.message(socket, message);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    return this.#subscriptions.close(socket, code, reason);
  }

  webSocketError(socket: WebSocket) {
    return this.#subscriptions.close(socket, 1011, "Socket error");
  }

  alarm() {
    return this.#subscriptions.alarm();
  }

  #prepareFacet(deployment: ServerDeployment, identity: Identity) {
    return Effect.gen({ self: this }, function* prepareFacet() {
      const version = `${deployment.deploymentId}:${deployment.checksum}`;
      // Verify code before stopping the running version. Cache belongs to this installation.
      const code = yield* this.#source.code(deployment);
      return yield* Effect.try({
        try: () => {
          if (identity.expiresAt <= Date.now()) {
            throw new AppError("UNAUTHORIZED", "App token expired");
          }

          const previous = this.ctx.storage.kv.get<string>("version");

          if (previous && previous !== version) {
            for (const socket of this.ctx.getWebSockets()) {
              socket.close(1012, "App deployment changed");
            }
            this.#actions.closeAll();
            this.ctx.facets.abort("app", "App deployment changed");
          }

          this.ctx.storage.kv.put("version", version);

          const facet = this.ctx.facets.get("app", () => {
            const worker = this.env.LOADER.get(`${this.ctx.id.toString()}:${version}`, () => ({
              compatibilityDate: "2026-10-01",
              compatibilityFlags: ["nodejs_als"],
              mainModule: "bootstrap.js",
              modules: { "bootstrap.js": bootstrap, "application.js": code },
              globalOutbound: null,
              env: {},
              limits: { cpuMs: 10, subRequests: 64 },
            }));

            return { class: worker.getDurableObjectClass<AppFacet>("AppFacet") };
          }) as unknown as Pick<AppFacet, "query" | "mutate" | "action">;
          // Runtime results have already passed JSON validation; CF's RPC types cannot describe unknown values.
          return { facet };
        },
        catch: appError,
      });
    });
  }

  #action(input: Invocation, identity: Identity, token: string, signal?: AbortSignal) {
    const admission = this.#queue.withPermits(1)(
      Effect.gen({ self: this }, function* admission() {
        const facet = yield* this.#facet(identity);
        return { facet, lease: this.#actions.open(identity, signal) };
      }),
    );
    return Effect.acquireUseRelease(
      admission,
      ({ facet, lease }) =>
        Effect.tryPromise({
          try: () => {
            lease.signal.throwIfAborted();
            const capability = new ActionCapability(
              lease,
              (tables) =>
                Effect.runPromise(this.#queue.withPermits(1)(this.#refresh(tables, facet))),
              { url: identity.toolUrl, token },
            );
            return abortable(
              facet.action(input, identity, capability, cancellationStream(lease.signal)),
              lease.signal,
            );
          },
          catch: appError,
        }),
      ({ lease }) => Effect.sync(() => lease.close()),
    );
  }
}
