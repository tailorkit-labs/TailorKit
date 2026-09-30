import { DurableObject } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import type { StorageEnvironment } from "./env";
import type { StorageIdentity } from "./server";
import {
  bearerToken,
  installationKey,
  storageTokenVerifier,
  storageMigrationTokenVerifier,
} from "./auth";
import type { StorageTrust } from "./auth";
import { StorageError, storageError } from "./errors";
import { Authentication, InstallationRouting, dispatch } from "./orchestration";

/** Serialized code is data to the supervisor. It is never imported or evaluated here. */
export interface StorageArtifact {
  readonly code: string;
  readonly codeHash: string;
  readonly apiVersion: number;
  readonly migrations: readonly { readonly id: string; readonly hash: string }[];
}
function trust(env: StorageEnvironment): StorageTrust {
  return {
    issuer: env.STORAGE_ISSUER,
    audience: env.STORAGE_AUDIENCE,
    appId: env.STORAGE_APP_ID,
    publicKeys: JSON.parse(env.STORAGE_PUBLIC_KEYS) as StorageTrust["publicKeys"],
  };
}
function authentication(env: StorageEnvironment) {
  const calls = storageTokenVerifier(trust(env));
  const migrations = storageMigrationTokenVerifier(trust(env));
  return Layer.succeed(Authentication, {
    verify: (request, migration) =>
      Effect.tryPromise({
        try: () => (migration ? migrations : calls)(bearerToken(request)),
        catch: storageError,
      }),
  });
}
function errorResponse(error: unknown) {
  const failure = storageError(error);
  const status = {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INCOMPATIBLE_VERSION: 409,
    UNAVAILABLE: 503,
    INTERNAL_SERVER_ERROR: 500,
  }[failure.code];
  return Response.json({ code: failure.code, message: failure.message }, { status });
}
/** Enforce stream expiry outside untrusted app code, including an app that ignores our runtime. */
function authenticatedResponse(response: Response, expiresAt: number): Response {
  if (!response.body) {
    return response;
  }
  const reader = response.body.getReader();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(
        () => {
          if (stopped) {
            return;
          }
          stopped = true;
          // End the stream cleanly so the host SDK reconnects with a renewed token.
          controller.close();
          void reader.cancel().catch(() => {});
        },
        Math.max(0, expiresAt - Date.now()),
      );
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (stopped) {
          return;
        }
        if (chunk.done) {
          stopped = true;
          clearTimeout(timer);
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        if (!stopped) {
          stopped = true;
          clearTimeout(timer);
          controller.error(error);
        }
      }
    },
    async cancel() {
      stopped = true;
      clearTimeout(timer);
      await reader.cancel();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
async function migrationBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new StorageError("BAD_REQUEST", "Migration manifest required");
  }
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    bytes += chunk.value.byteLength;
    if (bytes > 1024 * 1024) {
      await reader.cancel();
      throw new StorageError("BAD_REQUEST", "Migration manifest is too large");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch {
    throw new StorageError("BAD_REQUEST", "Invalid migration manifest");
  }
}
function migratedByCli(artifact: StorageArtifact, body: unknown) {
  if (!body || typeof body !== "object") {
    return false;
  }
  const candidate = body as { codeHash?: string; apiVersion?: number; migrations?: unknown };
  return (
    candidate.codeHash === artifact.codeHash &&
    candidate.apiVersion === artifact.apiVersion &&
    JSON.stringify(candidate.migrations) === JSON.stringify(artifact.migrations)
  );
}

export function createStorageDurableObject(
  artifact: StorageArtifact,
): new (
  ctx: DurableObjectState,
  env: StorageEnvironment,
) => DurableObject<StorageEnvironment> & { fetch(request: Request): Promise<Response> } {
  return class StorageSupervisor extends DurableObject<StorageEnvironment> {
    #auth: ReturnType<typeof authentication>;
    constructor(ctx: DurableObjectState, env: StorageEnvironment) {
      super(ctx, env);
      this.#auth = authentication(env);
      // Keep the facet name stable. New code gets a new loader key, never a new database.
      const old = ctx.storage.kv.get<string>("codeHash");
      if (old && old !== artifact.codeHash) {
        ctx.facets.abort("app", "App code updated");
      }
      ctx.storage.kv.put("codeHash", artifact.codeHash);
    }
    fetch(request: Request): Promise<Response> {
      const migration = new URL(request.url).pathname === "/_tailorkit/migrate";
      const routing = Layer.succeed(InstallationRouting, {
        forward: (incoming: Request, identity: StorageIdentity) =>
          Effect.tryPromise({
            try: async () => {
              const expected = this.env.STORES.idFromName(
                installationKey(identity, this.env.STORAGE_ISSUER),
              );
              if (!this.ctx.id.equals(expected)) {
                throw new StorageError("FORBIDDEN", "Installation mismatch");
              }
              if (migration && !migratedByCli(artifact, await migrationBody(incoming))) {
                throw new StorageError(
                  "INCOMPATIBLE_VERSION",
                  "CLI artifact differs from the running app; rebuild before migrating",
                );
              }
              const facet = this.ctx.facets.get("app", () => {
                // Installation is part of the cache key: app module globals never span installations.
                const worker = this.env.LOADER.get(
                  `${this.ctx.id.toString()}:${artifact.codeHash}`,
                  () => ({
                    compatibilityDate: "2026-08-27",
                    mainModule: "app.js",
                    modules: { "app.js": artifact.code },
                    globalOutbound: null,
                    env: {},
                    limits: { cpuMs: 50, subRequests: 0 },
                  }),
                );
                return { class: worker.getDurableObjectClass("AppFacet") };
              });
              const headers = new Headers(incoming.headers);
              headers.delete("authorization");
              headers.set("x-tailorkit-identity", JSON.stringify(identity));
              // Migration requests have no user SQL; the CLI authorizes the bundled migration history.
              const forwarded = new Request(incoming.url, {
                method: "POST",
                headers,
                body: migration ? undefined : incoming.body,
                signal: incoming.signal,
              });
              return authenticatedResponse(await facet.fetch(forwarded), identity.expiresAt);
            },
            catch: storageError,
          }),
      });
      return Effect.runPromise(
        dispatch(request, migration).pipe(
          Effect.provide(Layer.merge(this.#auth, routing)),
          Effect.catch((error) => Effect.succeed(errorResponse(error))),
        ),
      );
    }
  };
}

/** Trusted entry point, shared by Cloudflare and standalone workerd/Docker. */
export function createStorageWorker(artifact: StorageArtifact): {
  fetch(request: Request, env: StorageEnvironment): Promise<Response>;
} {
  return {
    async fetch(request, env) {
      const origin = request.headers.get("origin");
      const origins = JSON.parse(env.STORAGE_ORIGINS) as string[];
      if (origin && !origins.includes(origin)) {
        return errorResponse(new StorageError("FORBIDDEN", "Forbidden origin"));
      }
      const cors = new Headers({ "cache-control": "no-store", vary: "Origin" });
      if (origin) {
        cors.set("access-control-allow-origin", origin);
      }
      cors.set("access-control-allow-methods", "POST, OPTIONS");
      cors.set("access-control-allow-headers", "authorization, content-type");
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }
      const pathname = new URL(request.url).pathname;
      if (request.method === "GET" && pathname === "/_tailorkit/storage") {
        return Response.json(
          {
            protocol: 1,
            appId: env.STORAGE_APP_ID,
            apiVersion: artifact.apiVersion,
            codeHash: artifact.codeHash,
            migrations: artifact.migrations,
          },
          { headers: cors },
        );
      }
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405, headers: cors });
      }
      if (pathname !== "/_tailorkit/migrate" && !pathname.startsWith("/rpc/")) {
        return new Response("Not found", { status: 404, headers: cors });
      }
      if (Number(request.headers.get("content-length") ?? 0) > 1024 * 1024) {
        return new Response("Too large", { status: 413 });
      }
      const routing = Layer.succeed(InstallationRouting, {
        forward: (incoming: Request, identity: StorageIdentity) =>
          Effect.tryPromise({
            try: () =>
              env.STORES.get(
                env.STORES.idFromName(installationKey(identity, env.STORAGE_ISSUER)),
              ).fetch(incoming),
            catch: storageError,
          }),
      });
      const response = await Effect.runPromise(
        dispatch(request, pathname === "/_tailorkit/migrate").pipe(
          Effect.provide(Layer.merge(authentication(env), routing)),
          Effect.catch((error) => Effect.succeed(errorResponse(error))),
        ),
      );
      const headers = new Headers(response.headers);
      cors.forEach((value, key) => headers.set(key, value));
      return new Response(response.body, { status: response.status, headers });
    },
  };
}
