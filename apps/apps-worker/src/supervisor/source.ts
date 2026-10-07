import { maxDeploymentBytes } from "@tailorkit/asset-delivery";
import { Effect } from "effect";
import { appError } from "../runtime/errors";
import { appDeploymentMetadata, deploymentMetadataKey } from "@tailorkit/api-utils/app-auth";
import type { AppDeploymentMetadata } from "@tailorkit/api-utils/app-auth";
import { AppError } from "@tailorkit/app/server";
import type { Identity } from "@tailorkit/app/server";

export type ServerDeployment = AppDeploymentMetadata;

/** Deployment selects code, never the database. Issuer also separates trusted hosts. */
export function installationName(identity: Identity, issuer: string) {
  return JSON.stringify([issuer, identity.projectId, identity.appId, identity.installationId]);
}

export const metadataLifetimeSeconds = 300;

/** Bound stored and inflated bytes before allocating or executing bundle code. */
async function readBundleBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxDeploymentBytes) {
        await reader.cancel();
        throw new Error("Server bundle exceeds deployment size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Only this trusted service sees platform credentials or the private R2 binding. */
export function deploymentSource(
  env: Pick<Env, "PLATFORM_URL" | "RUNTIME_SERVICE_TOKEN"> & {
    DEPLOYMENTS: Pick<KVNamespace, "get" | "put">;
    BUNDLES: { get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null> };
  },
) {
  let cached: { version: string; code: string } | undefined;
  return {
    current: (identity: Identity, runningDeploymentId?: string) =>
      Effect.tryPromise({
        try: async () => {
          const key = deploymentMetadataKey(identity);
          const cachedMetadata = appDeploymentMetadata.safeParse(
            await env.DEPLOYMENTS.get(key, "json").catch(() => null),
          );
          let deployment = cachedMetadata.success ? cachedMetadata.data : undefined;
          // Confirm a changed pointer with the authority before switching schemas.
          // This prevents a stale KV replica from switching an installation backwards.
          if (
            !deployment ||
            (runningDeploymentId && deployment.deploymentId !== runningDeploymentId)
          ) {
            const base = new URL(
              env.PLATFORM_URL.endsWith("/") ? env.PLATFORM_URL : `${env.PLATFORM_URL}/`,
            );
            if (base.protocol !== "https:") {
              throw new Error("Platform URL requires HTTPS");
            }

            const response = await fetch(
              new URL(`apps/${encodeURIComponent(identity.appId)}/runtime`, base),
              {
                method: "POST",
                headers: {
                  authorization: `Bearer ${env.RUNTIME_SERVICE_TOKEN}`,
                  "content-type": "application/json",
                  "x-tailorkit-project-id": identity.projectId,
                },
                body: JSON.stringify({}),
                redirect: "manual",
                signal: AbortSignal.timeout(10_000),
              },
            );

            if (!response.ok) {
              throw new AppError("UNAVAILABLE", "Published app metadata unavailable");
            }

            deployment = appDeploymentMetadata.parse(await response.json());
            if (
              deployment.projectId !== identity.projectId ||
              deployment.appId !== identity.appId
            ) {
              throw new AppError("FORBIDDEN", "App or project mismatch");
            }
            await env.DEPLOYMENTS.put(key, JSON.stringify(deployment), {
              expirationTtl: metadataLifetimeSeconds,
            }).catch((error) => console.error("Could not cache app deployment metadata", error));
          }
          if (deployment.projectId !== identity.projectId || deployment.appId !== identity.appId) {
            throw new AppError("FORBIDDEN", "App or project mismatch");
          }
          if (identity.expiresAt <= Date.now()) {
            throw new AppError("UNAUTHORIZED", "App token expired");
          }
          return deployment;
        },
        catch: appError,
      }),

    code: (deployment: ServerDeployment) =>
      Effect.tryPromise({
        try: async () => {
          const version = `${deployment.deploymentId}:${deployment.checksum}:${deployment.contentEncoding ?? "utf-8"}`;
          if (cached?.version === version) {
            return cached.code;
          }
          const object = await env.BUNDLES.get(deployment.objectKey);
          if (!object) {
            throw new AppError("NOT_FOUND", "Server bundle missing");
          }

          const bytes = await readBundleBytes(object.body);
          if (bytes.byteLength !== deployment.contentLength) {
            throw new Error("Server bundle size mismatch");
          }

          const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          const checksum = [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
          if (checksum !== deployment.checksum) {
            throw new Error("Server bundle checksum mismatch");
          }

          const decoded =
            deployment.contentEncoding === "gzip"
              ? await readBundleBytes(
                  new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip")),
                )
              : bytes;
          const code = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
          cached = { version, code };
          return code;
        },
        catch: appError,
      }),
  };
}
