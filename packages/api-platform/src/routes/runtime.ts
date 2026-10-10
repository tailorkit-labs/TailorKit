import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { env } from "../env";
import { Effect } from "effect";
import type { AppDeploymentMetadata } from "@tailorkit/api-utils/app-auth";
import {
  APP_PUBLIC_KEYS_CACHE_SECONDS,
  appDeploymentMetadata,
} from "@tailorkit/api-utils/app-auth";
import { db } from "@tailorkit/db";
import z from "zod";
import { o, protectedRouter, requireAppInScopes } from "../procedures";
import {
  appRuntimePublicKeys,
  issueAppRuntimeToken,
  issueAppToolToken,
  verifyAppRuntimeToken,
} from "../runtime/auth";
import { canonicalizeScope, scopesSchema } from "../scope";

/** Public routes must be dispatched before constructing the authenticated platform context. */
export function handlePublicRuntimeRequest(request: Request): Response | undefined {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/api/platform/runtime/keys") {
    return undefined;
  }
  return appRuntimeKeysResponse();
}

export function appRuntimeKeysResponse(): ReturnType<typeof Response.json> {
  try {
    return Response.json(appRuntimePublicKeys(), {
      headers: { "cache-control": `public, max-age=${APP_PUBLIC_KEYS_CACHE_SECONDS}` },
    });
  } catch {
    return new Response("Signing keys unavailable", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}

// Hosts authenticate with their project key and assert membership using verified scopes.
export const runtimeSession = protectedRouter
  .meta(openapi({ path: "/apps/{appId}/runtime/session", method: "POST" }))
  .input(
    z.object({
      params: z.object({ appId: z.string().min(1).max(256) }),
      body: z.strictObject({
        scopes: scopesSchema,
        subjectId: z.string().min(1).max(256).optional(),
        toolUrl: z.url().refine((value) => {
          const url = new URL(value);
          return (
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            (url.protocol === "https:" ||
              (url.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
          );
        }, "Tool URL requires HTTPS"),
      }),
    }),
  )
  .output(z.object({ body: z.object({ token: z.string(), expiresAt: z.number(), url: z.url() }) }))
  .use(
    requireAppInScopes.adaptInput(({ params: { appId }, body: { scopes } }) => ({ appId, scopes })),
  )
  .handler(async ({ context, input }) => {
    const deployment = context.app.currentDeployment;
    if (!deployment) {
      throw new ORPCError("NOT_FOUND", { message: "App has no published deployment." });
    }
    const runtime = new URL(
      env.APP_RUNTIME_URL ??
        `https://${context.organization.publicId}.${env.ASSET_DOMAIN ?? "tailorkit.app"}`,
    );
    if (
      runtime.username ||
      runtime.password ||
      runtime.search ||
      runtime.hash ||
      (runtime.protocol !== "https:" &&
        !(
          runtime.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(runtime.hostname)
        ))
    ) {
      throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Invalid app runtime configuration." });
    }
    const url = new URL(`/p/${context.project.id}/a/${context.app.publicId}/rpc`, runtime);
    // Each app belongs to one installation scope. Resolve identity from the authorized
    // database record, never from browser input or the ordering of the viewer's scopes.
    const session = await issueAppRuntimeToken({
      subjectId: input.body.subjectId,
      scope: context.app.scope,
      toolUrl: input.body.toolUrl,
      installationId: context.app.id,
      projectId: context.project.id,
      appId: context.app.id,
      deploymentId: deployment.id,
      publicTeamId: context.organization.publicId,
      appPublicId: context.app.publicId,
    });
    return { body: { ...session, url: url.href } };
  });

// Trusted runtime metadata: return the authorized private R2 key without minting a download URL.
export const getRuntimeBundle = protectedRouter
  .meta(openapi({ path: "/apps/{appId}/runtime", method: "POST" }))
  .input(z.object({ params: z.object({ appId: z.string() }), body: z.object({}) }))
  .output(z.object({ body: appDeploymentMetadata }))
  .use(
    o
      .middleware(async ({ context, next }, input: { appId: string }) => {
        if (!context.runtimeService) {
          throw new ORPCError("FORBIDDEN");
        }

        const app = await db.query.app.findFirst({
          where: { id: input.appId, projectId: context.project.id },
          with: { currentDeployment: { where: { status: "published" } } },
        });
        if (!app) {
          throw new ORPCError("NOT_FOUND");
        }

        return next({ context: { ...context, app } });
      })
      .adaptInput(({ params }) => ({ appId: params.appId })),
  )
  .handler(async ({ context }) => {
    const deployment = context.app.currentDeployment;
    if (!deployment) {
      throw new ORPCError("NOT_FOUND");
    }
    const key = `teams/${context.organization.publicId}/projects/${context.project.id}/apps/${context.app.publicId}/deployments/${deployment.publicId}/server/server.js`;
    const file = await db.query.appDeploymentFile.findFirst({
      where: { appDeploymentId: deployment.id, objectKey: key, status: "verified" },
    });
    if (!file?.checksum) {
      throw new ORPCError("NOT_FOUND");
    }
    return {
      body: {
        projectId: context.project.id,
        appId: context.app.id,
        deploymentId: deployment.id,
        objectKey: file.objectKey,
        checksum: file.checksum,
        contentLength: file.contentLength,
        contentEncoding: file.encoding === "gzip" ? "gzip" : undefined,
      },
    };
  });

/** Cache publication failures do not undo a published deployment; worker misses use the API. */
export function publishRuntimeMetadata(metadata: AppDeploymentMetadata, appPublicId: string) {
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        if (!env.APP_RUNTIME_SERVICE_TOKEN) {
          return;
        }
        const url = new URL(
          `/p/${metadata.projectId}/a/${appPublicId}/new-deployment`,
          env.APP_RUNTIME_INTERNAL_URL ?? `https://internal.${env.ASSET_DOMAIN ?? "tailorkit.app"}`,
        );
        if (url.protocol !== "https:") {
          throw new Error("App runtime URL requires HTTPS");
        }
        const response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.APP_RUNTIME_SERVICE_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(metadata),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          throw new Error(`Runtime metadata publication failed (${response.status})`);
        }
      },
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => console.error("Could not publish app runtime metadata", error)),
      ),
    ),
  );
}

/** Exchange a verified runtime execution credential for one product tool credential. */
export async function handleToolCredentialRequest(request: Request): Promise<Response | undefined> {
  if (new URL(request.url).pathname !== "/api/platform/runtime/tools") return undefined;
  const headers = { "cache-control": "no-store" };
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers });
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new Error("Missing token");
    const identity = await verifyAppRuntimeToken(authorization.slice(7));
    const input = z
      .strictObject({
        path: z
          .string()
          .max(512)
          .regex(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/u),
      })
      .parse(await request.json());
    const app = await db.query.app.findFirst({
      where: { id: identity.appId, projectId: identity.projectId },
      with: { currentDeployment: true },
    });
    if (
      !app ||
      app.id !== identity.installationId ||
      app.currentDeployment?.id !== identity.deploymentId ||
      app.scopeKey !== canonicalizeScope(identity.scope).scopeKey
    )
      throw new Error("Installation unavailable");
    const credential = await issueAppToolToken(identity, input.path);
    return Response.json({ ...credential, url: identity.toolUrl, identity }, { headers });
  } catch {
    return new Response("Unauthorized", { status: 401, headers });
  }
}
