import { Effect } from "effect";
import { z } from "zod";
import type { ArtifactSource } from "@tailorkit/app-storage/orchestration";
import { storageError, type StorageBundle } from "@tailorkit/app-storage/runtime";
import { StorageError } from "@tailorkit/app-storage";
import type { StorageEnvironment } from "./env";

const serverDownload = z.object({
  body: z.object({
    url: z.url().max(4096),
    checksum: z.string().regex(/^[a-f0-9]{64}$/u),
    contentLength: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024),
  }),
});

async function readBounded(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) throw new Error("Missing download body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Download exceeds its allowed size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Credentials and private download URLs remain in the trusted supervisor. */
export function platformArtifacts(env: StorageEnvironment): ArtifactSource["Service"] {
  let cached: StorageBundle | undefined;
  return {
    get: (identity) =>
      Effect.tryPromise({
        try: async (): Promise<StorageBundle> => {
          if (!env.PLATFORM_URL || !env.PLATFORM_TOKEN || !env.STORAGE_SCOPE) {
            throw new StorageError(
              "INTERNAL_SERVER_ERROR",
              "Configure the private platform artifact source",
            );
          }
          const base = new URL(
            env.PLATFORM_URL.endsWith("/") ? env.PLATFORM_URL : `${env.PLATFORM_URL}/`,
          );
          if (base.protocol !== "https:") throw new Error("Platform URL must use HTTPS");
          const metadata = await fetch(
            new URL(`apps/${encodeURIComponent(identity.appId)}/server`, base),
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${env.PLATFORM_TOKEN}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ scope: JSON.parse(env.STORAGE_SCOPE) }),
              redirect: "error",
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!metadata.ok)
            throw new StorageError("NOT_FOUND", "No published server bundle for this app");
          const { body } = serverDownload.parse(
            JSON.parse(new TextDecoder().decode(await readBounded(metadata, 16 * 1024))),
          );
          if (cached?.codeHash === body.checksum) return cached;
          const url = new URL(body.url);
          if (url.protocol !== "https:") throw new Error("Private blob download must use HTTPS");
          const response = await fetch(url, {
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok || !response.body) throw new Error("Server bundle download failed");
          const bytes = await readBounded(response, body.contentLength);
          if (bytes.byteLength !== body.contentLength)
            throw new Error("Server bundle size mismatch");
          const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          const checksum = [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
          if (checksum !== body.checksum) throw new Error("Server bundle checksum mismatch");
          // The uploaded code carries its own API validation; no migration metadata is fetched.
          cached = {
            code: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            codeHash: checksum,
          };
          return cached;
        },
        catch: storageError,
      }),
  };
}
