import { StorageError } from "@tailorkit/app-storage";
import {
  APP_RUNTIME_AUDIENCE,
  appRuntimeIssuer,
  storageTokenVerifier,
} from "@tailorkit/app-storage/auth";
import { z } from "zod";
import { readBounded } from "./http";

// Cache only completed key data, never an in-flight request across Worker requests.
const keys = new WeakMap<
  object,
  { expiresAt: number; verify: ReturnType<typeof storageTokenVerifier> }
>();

export function verifier(env: Pick<Env, "PLATFORM_URL">) {
  return async (token: string) => {
    let cached = keys.get(env);
    if (!cached || cached.expiresAt <= Date.now()) {
      const issuer = appRuntimeIssuer(env.PLATFORM_URL);
      const response = await fetch(`${issuer}/runtime/keys`, {
        redirect: "manual",
        credentials: "omit",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new StorageError("UNAVAILABLE", "Platform signing keys unavailable");
      const publicKeys = z
        .object({
          keys: z
            .array(
              z.object({
                kty: z.literal("EC"),
                crv: z.literal("P-256"),
                kid: z.string().min(1),
                x: z.string().min(1),
                y: z.string().min(1),
                d: z.never().optional(),
              }),
            )
            .min(1)
            .max(32),
        })
        .parse(JSON.parse(new TextDecoder().decode(await readBounded(response, 16 * 1024))));
      cached = {
        expiresAt: Date.now() + 60_000,
        verify: storageTokenVerifier({
          issuer,
          audience: APP_RUNTIME_AUDIENCE,
          requireDeployment: true,
          publicKeys,
        }),
      };
      keys.set(env, cached);
    }
    return cached.verify(token);
  };
}
