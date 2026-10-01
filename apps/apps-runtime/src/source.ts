import { Effect } from "effect";
import { z } from "zod";
import { AppError } from "@tailorkit/apps-server";
import { appError } from "@tailorkit/apps-server/runtime";
import type { DeploymentSource } from "./runtime";
import { readBounded } from "./http";

const metadata = z.object({
  body: z.object({
    projectId: z.string().min(1),
    appId: z.string().min(1),
    deploymentId: z.string().min(1),
    objectKey: z.string().min(1).max(4096),
    checksum: z.string().regex(/^[a-f0-9]{64}$/u),
    contentLength: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024),
  }),
});
/** Only this trusted service sees platform credentials or the private R2 binding. */
export function deploymentSource(
  env: Pick<Env, "PLATFORM_URL" | "RUNTIME_SERVICE_TOKEN"> & {
    BUNDLES: { get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null> };
  },
): DeploymentSource["Service"] {
  return {
    current: (identity) =>
      Effect.tryPromise({
        try: async () => {
          const base = new URL(
            env.PLATFORM_URL.endsWith("/") ? env.PLATFORM_URL : `${env.PLATFORM_URL}/`,
          );
          if (base.protocol !== "https:") throw new Error("Platform URL requires HTTPS");
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
          if (!response.ok) throw new AppError("UNAVAILABLE", "Published app metadata unavailable");
          return metadata.parse(
            JSON.parse(new TextDecoder().decode(await readBounded(response, 16 * 1024))),
          ).body;
        },
        catch: appError,
      }),
    code: (deployment) =>
      Effect.tryPromise({
        try: async () => {
          const object = await env.BUNDLES.get(deployment.objectKey);
          if (!object) throw new AppError("NOT_FOUND", "Server bundle missing");
          const bytes = await readBounded(new Response(object.body), deployment.contentLength);
          if (bytes.byteLength !== deployment.contentLength)
            throw new Error("Server bundle size mismatch");
          const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          const checksum = [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
          if (checksum !== deployment.checksum) throw new Error("Server bundle checksum mismatch");
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        },
        catch: appError,
      }),
  };
}
