import { createLocalJWKSet, importJWK, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { StorageError } from "./errors";
import type { StorageIdentity } from "./server";

export interface StorageSigningOptions {
  issuer: string;
  audience: string;
  keyId: string;
  /** ES256 private key. Keep this in the host server only. */
  privateKey: CryptoKey | JsonWebKey;
  lifetimeSeconds?: number;
}
export interface StorageTrust {
  issuer: string;
  audience: string;
  appId: string;
  /** Trusted host public keys, provisioned by the operator; never read from JWT headers. */
  publicKeys: { keys: (JsonWebKey & { kid: string })[] };
}
const access = z.object({
  sub: z.string().min(1).max(256),
  appId: z.string().min(1).max(256),
  installationId: z.string().min(1).max(256),
  exp: z.number().int(),
  iat: z.number().int(),
});
export async function issueStorageToken(
  options: StorageSigningOptions,
  identity: Omit<StorageIdentity, "expiresAt">,
  purpose: "calls" | "migrations" = "calls",
) {
  const lifetime = options.lifetimeSeconds ?? 120;
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > 300) {
    throw new Error("Storage tokens must last 1–300 seconds");
  }
  const now = Math.floor(Date.now() / 1000);
  access.parse({
    sub: identity.userId,
    appId: identity.appId,
    installationId: identity.installationId,
    iat: now,
    exp: now + lifetime,
  });
  const key =
    "kty" in options.privateKey
      ? await importJWK({ ...options.privateKey, alg: "ES256" }, "ES256")
      : options.privateKey;
  const token = await new SignJWT({
    appId: identity.appId,
    installationId: identity.installationId,
    purpose,
  })
    .setProtectedHeader({ alg: "ES256", kid: options.keyId, typ: "JWT" })
    .setSubject(identity.userId)
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetime)
    .sign(key);
  return { token, expiresAt: (now + lifetime) * 1000 };
}
export function storageTokenVerifier(
  trust: StorageTrust,
  purpose: "calls" | "migrations" = "calls",
) {
  if (
    !trust.publicKeys.keys.length ||
    trust.publicKeys.keys.some(
      (key) => key.d || key.kty !== "EC" || key.crv !== "P-256" || !key.kid,
    )
  ) {
    throw new Error("Configure trusted ES256 public signing keys");
  }
  const keys = createLocalJWKSet({
    keys: trust.publicKeys.keys.map((key) => ({ ...key, alg: "ES256", use: "sig" })),
  });
  return async (token: string): Promise<StorageIdentity> => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: trust.issuer,
        audience: trust.audience,
        algorithms: ["ES256"],
        typ: "JWT",
        requiredClaims: ["sub", "exp", "iat", "appId", "installationId"],
        maxTokenAge: "5m",
      });
      const claims = access.parse(payload);
      if (
        (payload.purpose ?? "calls") !== purpose ||
        claims.appId !== trust.appId ||
        claims.exp - claims.iat > 300 ||
        claims.iat > Math.floor(Date.now() / 1000)
      ) {
        throw new Error("Invalid storage access");
      }
      return Object.freeze({
        userId: claims.sub,
        appId: claims.appId,
        installationId: claims.installationId,
        expiresAt: claims.exp * 1000,
      });
    } catch {
      throw new StorageError("UNAUTHORIZED", "Invalid or expired storage token");
    }
  };
}
export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 8192) {
    throw new StorageError("UNAUTHORIZED", "Storage token required");
  }
  return authorization.slice(7);
}
/** Stable across deployments, unambiguous across installations. No client store IDs. */
export function installationKey(
  identity: Pick<StorageIdentity, "appId" | "installationId">,
  issuer: string,
) {
  return JSON.stringify([issuer, identity.appId, identity.installationId]);
}

/** Operator/CLI only. This token is never issued by the host SDK session endpoint. */
export function issueStorageMigrationToken(
  options: StorageSigningOptions,
  identity: Omit<StorageIdentity, "expiresAt">,
) {
  return issueStorageToken(
    { ...options, audience: `${options.audience}:migrations` },
    identity,
    "migrations",
  );
}
export function storageMigrationTokenVerifier(trust: StorageTrust) {
  return storageTokenVerifier({ ...trust, audience: `${trust.audience}:migrations` }, "migrations");
}
