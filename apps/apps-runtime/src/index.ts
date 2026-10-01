import {
  createRealtime,
  createRpcConnection,
  invocationSchema,
} from "@tailorkit/apps-server/runtime";
import type { Invocation, ExecutionResult, MutationResult } from "@tailorkit/apps-server/runtime";
import type { Identity } from "@tailorkit/apps-server";
import { z } from "zod";
import { DurableObject } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { bearerToken, appRuntimeIssuer } from "@tailorkit/apps-server/auth";
import { ActionLeases, abortable } from "./actions";
export { ActionBridge } from "./actions";
import { verifier } from "./auth";
import { AppError } from "@tailorkit/apps-server";
import { appError } from "@tailorkit/apps-server/runtime";
import { deploymentSource } from "./source";
import {
  DeploymentSource,
  FacetExecution,
  ActionExecution,
  executeAction,
  RequestQueue,
  execute,
  installationName,
} from "./runtime";
import { authenticatedResponse, errorResponse, readBounded } from "./http";

/** Trusted supervisor. The fixed facet name preserves SQLite when its code changes. */
export class AppInstallation extends DurableObject<Env> {
  #queue = new RequestQueue();
  #actions = new ActionLeases();
  #verify = verifier(this.env);
  #source = deploymentSource(this.env);
  #cached?: { version: string; code: string };
  #connections = new Set<WebSocket>();
  #realtime = createRealtime({
    query: (input, identity) => this.#invoke(input, identity, "query") as Promise<ExecutionResult>,
    mutate: (input, identity) =>
      this.#invoke(input, identity, "mutation") as Promise<MutationResult>,
  });

  fetch(request: Request): Promise<Response> {
    return this.#queue.run(async () => {
      try {
        const identity = await this.#verify(bearerToken(request));
        const expected = this.env.STORES.idFromName(
          installationName(identity, appRuntimeIssuer(this.env.PLATFORM_URL)),
        );
        if (!this.ctx.id.equals(expected)) throw new AppError("FORBIDDEN", "Installation mismatch");

        if (request.headers.get("upgrade")?.toLowerCase() === "websocket")
          return await this.#open(request, identity);
        return this.#run(request, identity);
      } catch (error) {
        return errorResponse(error);
      }
    });
  }
  async #run(request: Request, identity: Identity): Promise<Response> {
    const execution = Layer.succeed(FacetExecution, {
      forward: (incoming, access, deployment) =>
        Effect.tryPromise({
          try: async () => {
            const version = `${deployment.deploymentId}:${deployment.checksum}`;
            // Verify code before stopping the running version. Cache belongs to this installation.
            if (this.#cached?.version !== version) {
              const code = await Effect.runPromise(this.#source.code(deployment));
              this.#cached = { version, code };
            }

            if (access.expiresAt <= Date.now())
              throw new AppError("UNAUTHORIZED", "App token expired");

            const previous = this.ctx.storage.kv.get<string>("version");
            if (previous && previous !== version) {
              this.ctx.facets.abort("app", "App deployment changed");
              for (const socket of this.#connections) socket.close(1012, "App deployment changed");
            }
            this.ctx.storage.kv.put("version", version);

            const code = this.#cached.code;
            const facet = this.ctx.facets.get("app", () => {
              const worker = this.env.LOADER.get(`${this.ctx.id.toString()}:${version}`, () => ({
                compatibilityDate: "2026-09-21",
                mainModule: "app.js",
                modules: { "app.js": code },
                globalOutbound: null,
                env: {},
                limits: { cpuMs: 50, subRequests: 0 },
              }));
              return { class: worker.getDurableObjectClass("AppFacet") };
            });

            const headers = new Headers({
              "content-type": incoming.headers.get("content-type") ?? "application/json",
            });
            headers.set("x-tailorkit-identity", JSON.stringify(access));

            const forwarded = new Request(incoming.url, {
              method: "POST",
              headers,
              body: incoming.body,
              signal: incoming.signal,
            });

            return authenticatedResponse(await facet.fetch(forwarded), access.expiresAt);
          },
          catch: appError,
        }),
    });

    return await Effect.runPromise(
      execute(request, identity).pipe(
        Effect.provide(Layer.merge(Layer.succeed(DeploymentSource, this.#source), execution)),
        Effect.catch((error) => Effect.succeed(errorResponse(error))),
      ),
    );
  }

  async #invoke(
    input: Invocation & { requestId?: string; actionId?: string },
    identity: Identity,
    kind: "query" | "mutation",
  ) {
    return this.#queue.run(async () => {
      if (input.actionId) this.#actions.access(input.actionId, false);
      const response = await this.#run(
        new Request("https://app.internal/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: input.name,
            args: input.args,
            requestId: input.requestId,
            kind,
          }),
        }),
        identity,
      );
      const value = JSON.parse(new TextDecoder().decode(await readBounded(response, 1024 * 1024)));
      if (!response.ok)
        throw new AppError(
          value.code ?? "INTERNAL_SERVER_ERROR",
          value.message ?? "App function failed",
        );
      const result = z
        .object({
          value: z.unknown(),
          tables: z.array(z.string()).max(256),
          committed: z.boolean().optional(),
        })
        .parse(value);
      return result;
    });
  }

  /** These RPC methods are exposed only through installation-bound action capabilities. */
  actionAccess(actionId: string) {
    return this.#actions.access(actionId).deadline;
  }
  actionCall(actionId: string, kind: "query" | "mutation", raw: unknown) {
    const { identity } = this.#actions.access(actionId);
    const input = (
      kind === "query" ? invocationSchema : invocationSchema.extend({ requestId: z.uuid() })
    ).parse(raw);
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 1024 * 1024)
      throw new AppError("BAD_REQUEST", "Action input too large");
    const scoped = { ...input, actionId };
    return kind === "query"
      ? this.#realtime.query(scoped, identity)
      : this.#realtime.mutate(
          { ...scoped, requestId: (input as Invocation & { requestId: string }).requestId },
          identity,
        );
  }

  #action(input: Invocation, identity: Identity, signal?: AbortSignal) {
    // Actions stay outside both queues: callbacks can execute DB operations while external I/O waits.
    const provider = Layer.succeed(ActionExecution, {
      run: (invocation, access, deployment) =>
        Effect.tryPromise({
          try: async () => {
            const lease = this.#actions.open(access, signal);
            try {
              const version = `${deployment.deploymentId}:${deployment.checksum}`;
              const code =
                this.#cached?.version === version
                  ? this.#cached.code
                  : await Effect.runPromise(this.#source.code(deployment));
              lease.signal.throwIfAborted();
              const bridge = this.ctx.exports.ActionBridge({
                props: {
                  installationName: installationName(
                    access,
                    appRuntimeIssuer(this.env.PLATFORM_URL),
                  ),
                  actionId: lease.id,
                },
              });
              const worker = this.env.LOADER.load({
                compatibilityDate: "2026-09-21",
                mainModule: "app.js",
                modules: { "app.js": code },
                env: { DATABASE: bridge },
                globalOutbound: bridge,
                limits: { cpuMs: 50, subRequests: 64 },
              });
              const response = await abortable(
                worker.getEntrypoint().fetch(
                  new Request("https://app.internal/action", {
                    method: "POST",
                    headers: {
                      "content-type": "application/json",
                      "x-tailorkit-identity": JSON.stringify(access),
                    },
                    body: JSON.stringify(invocation),
                    signal: lease.signal,
                  }),
                ),
                lease.signal,
              );
              const result = JSON.parse(
                new TextDecoder().decode(
                  await abortable(readBounded(response, 1024 * 1024), lease.signal),
                ),
              );
              if (!response.ok)
                throw new AppError(
                  result.code ?? "INTERNAL_SERVER_ERROR",
                  result.message ?? "Action failed",
                );
              return result.value;
            } finally {
              lease.close();
            }
          },
          catch: appError,
        }),
    });
    return Effect.runPromise(
      executeAction(input, identity).pipe(
        Effect.provide(Layer.merge(Layer.succeed(DeploymentSource, this.#source), provider)),
      ),
    );
  }

  async #open(_request: Request, identity: Identity) {
    const current = await Effect.runPromise(this.#source.current(identity));
    if (current.projectId !== identity.projectId || current.appId !== identity.appId)
      throw new AppError("FORBIDDEN", "App or project mismatch");
    if (current.deploymentId !== identity.deploymentId)
      throw new AppError("INCOMPATIBLE_VERSION", "App deployment changed; reload the app");
    if (this.#connections.size >= 128)
      throw new AppError("BAD_REQUEST", "Installation connection limit exceeded");
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    this.#connections.add(server);
    const rpc = createRpcConnection(this.#realtime, server, identity, (input, access, signal) =>
      this.#action(input, access, signal),
    );
    const expiry = setTimeout(
      () => server.close(1008, "Authentication expired"),
      Math.max(0, identity.expiresAt - Date.now()),
    );
    server.addEventListener(
      "close",
      () => {
        clearTimeout(expiry);
        this.#connections.delete(server);
        void rpc.close();
      },
      { once: true },
    );
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": "tailorkit" },
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = new Headers({
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    });

    let response: Response;
    try {
      if (request.method === "OPTIONS") response = new Response(null, { status: 204 });
      else if (
        request.method === "GET" &&
        new URL(request.url).pathname.replace(/\/$/u, "") === "/rpc" &&
        request.headers.get("upgrade")?.toLowerCase() === "websocket"
      ) {
        const protocols =
          request.headers
            .get("sec-websocket-protocol")
            ?.split(",")
            .map((value) => value.trim()) ?? [];
        const token = protocols.find((value) => value.startsWith("jwt."))?.slice(4);
        if (!protocols.includes("tailorkit") || !token || token.length > 8192)
          throw new AppError("UNAUTHORIZED", "App token required");
        const identity = await verifier(env)(token);
        const headers = new Headers(request.headers);
        headers.set("authorization", `Bearer ${token}`);
        response = await env.STORES.getByName(
          installationName(identity, appRuntimeIssuer(env.PLATFORM_URL)),
        ).fetch(new Request(request.url, { headers }));
      } else if (request.method !== "POST" || !new URL(request.url).pathname.startsWith("/rpc/"))
        response = new Response("Not found", { status: 404 });
      else {
        const identity = await verifier(env)(bearerToken(request));
        const bytes = await readBounded(request, 1024 * 1024);
        response = await env.STORES.getByName(
          installationName(identity, appRuntimeIssuer(env.PLATFORM_URL)),
        ).fetch(
          new Request(request.url, {
            method: "POST",
            headers: request.headers,
            body: bytes,
            signal: request.signal,
          }),
        );
      }
    } catch (error) {
      response = errorResponse(error);
    }

    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    cors.forEach((value, key) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
