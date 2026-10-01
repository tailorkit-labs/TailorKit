import type { StorageTrust } from "@tailorkit/app-storage/auth";
import { createPrivateKey, createPublicKey } from "node:crypto";
import {
  APP_RUNTIME_AUDIENCE,
  appRuntimeIssuer,
  issueStorageToken,
} from "@tailorkit/app-storage/auth";
import { env } from "./env";

type PublicKey = StorageTrust["publicKeys"]["keys"][number];

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
  const previous = JSON.parse(env.APP_RUNTIME_PREVIOUS_PUBLIC_KEYS ?? '{"keys":[]}') as {
    keys: PublicKey[];
  };
  if (
    previous.keys.some(
      (value) => value.d || value.kty !== "EC" || value.crv !== "P-256" || !value.kid,
    )
  )
    throw new Error("Previous signing keys must be public ES256 keys");
  return { keys: [{ ...publicKey, kid: key.kid, alg: "ES256", use: "sig" }, ...previous.keys] };
}

export function issueAppRuntimeToken(identity: {
  userId: string;
  projectId: string;
  appId: string;
  installationId: string;
  deploymentId: string;
}) {
  const key = signingKey();
  return issueStorageToken(
    {
      issuer: appRuntimeIssuer(env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform"),
      audience: APP_RUNTIME_AUDIENCE,
      keyId: key.kid,
      privateKey: key,
    },
    identity,
  );
}

export function appRuntimeKeysResponse(): ReturnType<typeof Response.json> {
  try {
    return Response.json(appRuntimePublicKeys(), {
      headers: { "cache-control": "public, max-age=60" },
    });
  } catch {
    return new Response("Signing keys unavailable", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
