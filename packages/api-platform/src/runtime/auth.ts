import type {
  AppTokenTrust,
  AppTokenIdentity,
  VerifiedAppTokenIdentity,
} from "@tailorkit/api-utils/app-auth";
import { createPrivateKey, createPublicKey } from "node:crypto";
import {
  APP_RUNTIME_AUDIENCE,
  APP_TOOL_AUDIENCE,
  appTokenVerifier,
  appRuntimeIssuer,
  issueAppToken,
  parseAppPublicKeys,
} from "@tailorkit/api-utils/app-auth";
import { env } from "../env";

type PublicKey = AppTokenTrust["publicKeys"]["keys"][number];

function signingKey() {
  if (!env.APP_RUNTIME_SIGNING_KEY)
    throw new Error("APP_RUNTIME_SIGNING_KEY is required for app runtime tokens");
  const key = JSON.parse(env.APP_RUNTIME_SIGNING_KEY) as PublicKey;
  if (key.kty !== "EC" || key.crv !== "P-256" || !key.d || !key.kid)
    throw new Error("Configure an ES256 private JWK with a kid");
  return key;
}

export function appRuntimePublicKeys() {
  const key = signingKey();
  const publicKey = createPublicKey(createPrivateKey({ key, format: "jwk" })).export({
    format: "jwk",
  });
  // Publish retired public keys for at least six minutes after rotation (token + cache lifetime).
  let previous;
  try {
    previous = parseAppPublicKeys(
      JSON.parse(env.APP_RUNTIME_PREVIOUS_PUBLIC_KEYS ?? '{"keys":[]}'),
    );
  } catch {
    throw new Error("Previous signing keys must be public ES256 keys");
  }
  return { keys: [{ ...publicKey, kid: key.kid, alg: "ES256", use: "sig" }, ...previous.keys] };
}

export function issueAppRuntimeToken(identity: AppTokenIdentity) {
  const key = signingKey();
  return issueAppToken(
    {
      issuer: appRuntimeIssuer(env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform"),
      audience: APP_RUNTIME_AUDIENCE,
      purpose: "runtime",
      keyId: key.kid,
      privateKey: key,
    },
    identity,
  );
}

export function verifyAppRuntimeToken(token: string) {
  return appTokenVerifier({
    issuer: appRuntimeIssuer(env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform"),
    audience: APP_RUNTIME_AUDIENCE,
    purpose: "runtime",
    publicKeys: appRuntimePublicKeys(),
  })(token);
}
export function issueAppToolToken(identity: VerifiedAppTokenIdentity, toolPath: string) {
  const key = signingKey();
  return issueAppToken(
    {
      issuer: appRuntimeIssuer(env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform"),
      audience: APP_TOOL_AUDIENCE,
      purpose: "tool",
      toolPath,
      keyId: key.kid,
      privateKey: key,
      lifetimeSeconds: Math.min(60, Math.floor((identity.expiresAt - Date.now()) / 1000)),
    },
    identity,
  );
}
