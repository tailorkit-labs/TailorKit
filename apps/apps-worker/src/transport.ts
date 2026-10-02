import { handlerGen, middlewareGen } from "@orpc/experimental-effect";
import { ORPCError, COMMON_ERROR_STATUS_MAP, onError, implement } from "@orpc/server";
import { RPCHandler as FetchHandler } from "@orpc/server/fetch";
import { RPCHandler as WebSocketHandler } from "@orpc/server/websocket";
import { CORSHandlerPlugin } from "@orpc/server/plugins";
import {
  encodeHibernationRPCEvent,
  HibernationAsyncIteratorClass,
  HibernationHandlerPlugin,
} from "@orpc/hibernation";
import { decodePeerMessage, isPeerCancelMessage } from "@standard-server/peer";
import { Effect } from "effect";
import { appContract } from "@tailorkit/app/protocol";
import type { Invocation, MutationInvocation } from "@tailorkit/app/protocol";
import type { SubscriptionConnection } from "./supervisor/subscriptions";

export function wireError(error: unknown) {
  if (error instanceof ORPCError) {
    return error;
  }
  const failure = error as { code?: string; message?: string } | undefined;
  const code = failure?.code ?? "INTERNAL_SERVER_ERROR";
  return new ORPCError(code, {
    message: failure?.code ? failure.message : "App function failed",
  });
}

export const errorStatusMap = {
  ...COMMON_ERROR_STATUS_MAP,
  INCOMPATIBLE_VERSION: 409,
  UNAVAILABLE: 503,
};

/** Authentication failures must use the same oRPC wire format as procedure errors. */
export function rpcErrorResponse(error: unknown) {
  const failure = wireError(error);
  return Response.json(
    { json: failure.toJSON() },
    { status: errorStatusMap[failure.code as keyof typeof errorStatusMap] ?? 500 },
  );
}

/** The installation supplies these operations with its verified identity captured. */
export interface Installation {
  query(input: Invocation): Effect.Effect<unknown, unknown>;
  mutate(input: MutationInvocation): Effect.Effect<unknown, unknown>;
  action(input: Invocation, signal?: AbortSignal): Effect.Effect<unknown, unknown>;
}

const base = implement(appContract);
const errors = middlewareGen(function* errors({ next }) {
  return yield* next().pipe(Effect.mapError(wireError));
});
const http = base.$context<{ installation: Installation }>().use(errors);
const subscriptions = base
  .$context<{ subscribe: (input: Invocation) => HibernationAsyncIteratorClass<unknown> }>()
  .use(errors);
export const router = base.router({
  queries: http.queries.handler(
    handlerGen(function* queries({ input, context }) {
      return yield* context.installation.query(input);
    }),
  ),
  mutations: http.mutations.handler(
    handlerGen(function* mutations({ input, context }) {
      return yield* context.installation.mutate(input);
    }),
  ),
  actions: http.actions.handler(
    handlerGen(function* actions({ input, context, signal }) {
      return yield* context.installation.action(input, signal);
    }),
  ),
  // The public pass-through output schema preserves the hibernation callback.
  subscribe: subscriptions.subscribe.handler(
    handlerGen(function* subscribe({ input, context }) {
      return yield* Effect.try({
        try: () => context.subscribe(input),
        catch: (error) => error,
      });
    }),
  ),
});

/** The gateway and installation accept the same procedure routes. */
export function requestRoute(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/$/u, "");
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return request.method === "GET" && path === "/rpc/queries" ? "subscriptions" : undefined;
  }
  return request.method === "POST" &&
    !request.headers.has("upgrade") &&
    ["/rpc/queries", "/rpc/mutations", "/rpc/actions"].includes(path)
    ? "http"
    : undefined;
}

/** Authenticate before selecting an installation; WebSocket JWTs arrive as subprotocols. */
export function routeInstallation<Identity, Error>(
  request: Request,
  options: {
    verify(token: string): Effect.Effect<Identity, Error>;
    installation(identity: Identity): { fetch(request: Request): Promise<Response> };
  },
) {
  return Effect.gen(function* () {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }
    const route = requestRoute(request);
    if (!route) {
      return new Response("Not found", { status: 404 });
    }
    let token: string | undefined;
    if (route === "subscriptions") {
      const protocols =
        request.headers
          .get("sec-websocket-protocol")
          ?.split(",")
          .map((value) => value.trim()) ?? [];
      if (protocols.includes("tailorkit")) {
        token = protocols.find((value) => value.startsWith("jwt."))?.slice(4);
      }
    } else {
      token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/u)?.[1];
    }
    if (!token) {
      return yield* Effect.fail(new ORPCError("UNAUTHORIZED", { message: "App token required" }));
    }
    const identity = yield* options.verify(token);
    return yield* Effect.tryPromise({
      try: () => {
        if (route === "subscriptions") {
          const headers = new Headers(request.headers);
          headers.set("authorization", `Bearer ${token}`);
          return options
            .installation(identity)
            .fetch(new Request(request.url, { headers, signal: request.signal }));
        }
        return options.installation(identity).fetch(request);
      },
      catch: (error) => error,
    });
  });
}

export function createInstallationHandler() {
  return new FetchHandler(
    { queries: router.queries, mutations: router.mutations, actions: router.actions },
    {
      errorStatusMap,
      plugins: [new CORSHandlerPlugin()],
      interceptors: [
        onError((error) => {
          if (
            !(error instanceof ORPCError) ||
            ["INTERNAL_SERVER_ERROR", "UNAVAILABLE"].includes(error.code)
          ) {
            console.error(error);
          }
        }),
      ],
    },
  );
}

/** Call message immediately from the host's socket event to preserve oRPC ordering. */
export function createSubscriptionHandler() {
  const handler = new WebSocketHandler(
    { subscribe: router.subscribe },
    {
      plugins: [new HibernationHandlerPlugin()],
    },
  );
  return {
    message(
      socket: { send(data: string | Uint8Array<ArrayBuffer>): unknown },
      message: string | ArrayBuffer,
      subscribe: (input: Invocation) => HibernationAsyncIteratorClass<unknown>,
      cancel: (id: string) => Promise<void>,
    ) {
      const dispatched = handler.message(socket, message, { context: { subscribe } });
      // Hibernation detaches the iterator from the peer. Cancellation must also
      // remove persisted subscriptions, including after a new handler is created.
      const decoded = decodePeerMessage(
        typeof message === "string" ? message : new Uint8Array(message),
      );
      if (decoded.matched && isPeerCancelMessage(decoded.message)) {
        return Promise.all([dispatched, cancel(decoded.message.id)]).then(() => {});
      }
      return dispatched.then(() => {});
    },
    close: (socket: { send(data: string | Uint8Array<ArrayBuffer>): unknown }) =>
      handler.close(socket),
  };
}

/** Promise/iterator conversion belongs at the oRPC transport boundary. */
export function subscriptionStream(register: (id: string) => Effect.Effect<void, unknown>) {
  return new HibernationAsyncIteratorClass<unknown>((id) => Effect.runPromise(register(id)));
}

export function deliverSubscription(
  connection: SubscriptionConnection,
  id: string,
  value: unknown,
  error = false,
) {
  return Effect.tryPromise({
    try: async () => {
      connection.send(
        await encodeHibernationRPCEvent(
          id,
          error ? wireError(value) : value,
          error ? { event: "error" } : undefined,
        ),
      );
    },
    catch: (error) => error,
  });
}
