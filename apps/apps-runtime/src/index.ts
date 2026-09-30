import { DurableObject } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { bearerToken, storageTokenVerifier } from "@tailorkit/app-storage/auth";
import type { StorageTrust } from "@tailorkit/app-storage/auth";
import { StorageError } from "@tailorkit/app-storage";
import { storageError } from "@tailorkit/app-storage/runtime";
import type { RuntimeEnvironment } from "./env";
import { deploymentSource } from "./source";
import {
  DeploymentSource,
  FacetExecution,
  RequestQueue,
  execute,
  installationName,
  runtimeIdentity,
} from "./runtime";
import { authenticatedResponse, errorResponse, readBounded } from "./http";

function verifier(env: RuntimeEnvironment) {
  if (!env.STORAGE_PROJECT_ID) throw new Error("Configure the trusted project");
  return storageTokenVerifier({
    issuer: env.STORAGE_ISSUER,
    audience: env.STORAGE_AUDIENCE,
    projectId: env.STORAGE_PROJECT_ID,
    requireDeployment: true,
    publicKeys: JSON.parse(env.STORAGE_PUBLIC_KEYS) as StorageTrust["publicKeys"],
  });
}

/** Trusted supervisor. The fixed facet name preserves SQLite when its code changes. */
export class AppInstallation extends DurableObject<RuntimeEnvironment> {
  #queue = new RequestQueue();
  #verify = verifier(this.env);
  #source = deploymentSource(this.env);
  #cached?: { version: string; code: string };

  fetch(request: Request): Promise<Response> {
    return this.#queue.run(async () => {
      try {
        const identity = runtimeIdentity(await this.#verify(bearerToken(request)));
        const expected = this.env.STORES.idFromName(
          installationName(identity, this.env.STORAGE_ISSUER),
        );
        if (!this.ctx.id.equals(expected))
          throw new StorageError("FORBIDDEN", "Installation mismatch");
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
                  throw new StorageError("UNAUTHORIZED", "Storage token expired");
                const previous = this.ctx.storage.kv.get<string>("version");
                if (previous && previous !== version)
                  this.ctx.facets.abort("app", "App deployment changed");
                this.ctx.storage.kv.put("version", version);
                const code = this.#cached.code;
                const facet = this.ctx.facets.get("app", () => {
                  const worker = this.env.LOADER.get(
                    `${this.ctx.id.toString()}:${version}`,
                    () => ({
                      compatibilityDate: "2026-09-21",
                      mainModule: "app.js",
                      modules: { "app.js": code },
                      globalOutbound: null,
                      env: {},
                      limits: { cpuMs: 50, subRequests: 0 },
                    }),
                  );
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
              catch: storageError,
            }),
        });
        return await Effect.runPromise(
          execute(request, identity).pipe(
            Effect.provide(Layer.merge(Layer.succeed(DeploymentSource, this.#source), execution)),
            Effect.catch((error) => Effect.succeed(errorResponse(error))),
          ),
        );
      } catch (error) {
        return errorResponse(error);
      }
    });
  }
}

export default {
  async fetch(request: Request, env: RuntimeEnvironment): Promise<Response> {
    const origin = request.headers.get("origin");
    const origins = JSON.parse(env.STORAGE_ORIGINS) as string[];
    if (origin && !origins.includes(origin))
      return errorResponse(new StorageError("FORBIDDEN", "Forbidden origin"));
    const cors = new Headers({
      "cache-control": "no-store",
      vary: "Origin",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    });
    if (origin) cors.set("access-control-allow-origin", origin);
    let response: Response;
    try {
      if (request.method === "OPTIONS") response = new Response(null, { status: 204 });
      else if (request.method !== "POST" || !new URL(request.url).pathname.startsWith("/rpc/"))
        response = new Response("Not found", { status: 404 });
      else {
        const identity = runtimeIdentity(await verifier(env)(bearerToken(request)));
        const bytes = await readBounded(request, 1024 * 1024);
        response = await env.STORES.getByName(installationName(identity, env.STORAGE_ISSUER)).fetch(
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
    const headers = new Headers(response.headers);
    cors.forEach((value, key) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<RuntimeEnvironment>;
