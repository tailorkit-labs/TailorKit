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

export function createAppRuntimeVerifier(options: RuntimeVerifierOptions) {
  const verify = createAppRuntimeVerifierEffect(options);
  return (token: string) => Effect.runPromise(verify(token));
}

let cached: { id: string; verify: ReturnType<typeof createAppRuntimeVerifier> } | undefined;

export function verifier(env: Env) {
  const id = JSON.stringify([env.PLATFORM_URL, env.APP_RUNTIME_PUBLIC_KEYS]);

  if (cached?.id !== id) {
    cached = {
      id,
      verify: createAppRuntimeVerifier({
        platformUrl: env.PLATFORM_URL,
        publicKeys: env.APP_RUNTIME_PUBLIC_KEYS,
      }),
    };
  }

  return cached.verify;
}
