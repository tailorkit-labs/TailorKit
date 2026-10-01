import { createLocalJWKSet, importJWK, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { AppError } from "./errors";
import type { Identity } from "./server/functions";

/** Fixed audience for the hosted app runtime. */
export const APP_RUNTIME_AUDIENCE = "tailorkit-apps-runtime";

export function appRuntimeIssuer(platformUrl: string) {
  const url = new URL(platformUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Platform URL requires HTTPS and no credentials, query or fragment");
  return url.href.replace(/\/$/u, "");
}

export interface AppSigningOptions {
  issuer: string;
  audience: string;
  keyId: string;
  /** ES256 private key. Keep this in the trusted issuing server only. */
  privateKey: CryptoKey | JsonWebKey;
  lifetimeSeconds?: number;
}
export interface AppTokenTrust {
  issuer: string;
  audience: string;
  appId?: string;
  projectId?: string;
  /** Trusted issuer public keys, provisioned by the operator; never read from JWT headers. */
  publicKeys: { keys: (JsonWebKey & { kid: string })[] };
}
const access = z.object({
  projectId: z.string().min(1).max(256),
  deploymentId: z.string().min(1).max(256),
  sub: z.string().min(1).max(256),
  appId: z.string().min(1).max(256),
  installationId: z.string().min(1).max(256),
  exp: z.number().int(),
  iat: z.number().int(),
});
export async function issueAppToken(
  options: AppSigningOptions,
  identity: Omit<Identity, "expiresAt">,
) {
  const lifetime = options.lifetimeSeconds ?? 120;
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > 300) {
    throw new Error("App tokens must last 1–300 seconds");
  }
  const now = Math.floor(Date.now() / 1000);
  access.parse({
    projectId: identity.projectId,
    deploymentId: identity.deploymentId,
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
    projectId: identity.projectId,
    deploymentId: identity.deploymentId,
    appId: identity.appId,
    installationId: identity.installationId,
    purpose: "calls",
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
export function appTokenVerifier(trust: AppTokenTrust) {
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
  return async (token: string): Promise<Identity> => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: trust.issuer,
        audience: trust.audience,
        algorithms: ["ES256"],
        typ: "JWT",
        requiredClaims: [
          "sub",
          "exp",
          "iat",
          "appId",
          "installationId",
          "projectId",
          "deploymentId",
        ],
        maxTokenAge: "5m",
      });
      const claims = access.parse(payload);
      if (
        (payload.purpose ?? "calls") !== "calls" ||
        (trust.appId !== undefined && claims.appId !== trust.appId) ||
        (trust.projectId !== undefined && claims.projectId !== trust.projectId) ||
        claims.exp - claims.iat > 300 ||
        claims.iat > Math.floor(Date.now() / 1000)
      ) {
        throw new Error("Invalid app access");
      }
      return Object.freeze({
        projectId: claims.projectId,
        deploymentId: claims.deploymentId,
        userId: claims.sub,
        appId: claims.appId,
        installationId: claims.installationId,
        expiresAt: claims.exp * 1000,
      });
    } catch {
      throw new AppError("UNAUTHORIZED", "Invalid or expired app token");
    }
  };
}
export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 8192) {
    throw new AppError("UNAUTHORIZED", "App token required");
  }
  return authorization.slice(7);
}
