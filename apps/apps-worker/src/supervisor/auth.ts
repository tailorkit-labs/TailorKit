import { Effect } from "effect";
import { AppError } from "../runtime/errors";
import {
  APP_RUNTIME_AUDIENCE,
  appRuntimeIssuer,
  appTokenVerifierEffect,
  parseAppPublicKeys,
} from "@tailorkit/api-utils/app-auth";

interface RuntimeVerifierOptions {
  platformUrl: string;
  publicKeys: unknown;
}

export function createAppRuntimeVerifierEffect(options: RuntimeVerifierOptions) {
  let verify: ReturnType<typeof appTokenVerifierEffect>;
  try {
    verify = appTokenVerifierEffect({
      issuer: appRuntimeIssuer(options.platformUrl),
      audience: APP_RUNTIME_AUDIENCE,
      purpose: "runtime",
      publicKeys: parseAppPublicKeys(
        typeof options.publicKeys === "string"
          ? JSON.parse(options.publicKeys)
          : options.publicKeys,
      ),
    });
  } catch {
    return (_token: string) =>
      Effect.fail(new AppError("UNAVAILABLE", "Invalid configured app public keys"));
  }
  return (token: string) => verify(token);
}

let cached: { id: string; verify: ReturnType<typeof createAppRuntimeVerifierEffect> } | undefined;

export function verifier(env: Env) {
  const id = JSON.stringify([env.PLATFORM_URL, env.APP_RUNTIME_PUBLIC_KEYS]);

  if (cached?.id !== id) {
    cached = {
      id,
      verify: createAppRuntimeVerifierEffect({
        platformUrl: env.PLATFORM_URL,
        publicKeys: env.APP_RUNTIME_PUBLIC_KEYS,
      }),
    };
  }

  return cached.verify;
}
