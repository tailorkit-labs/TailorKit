import { createLocalJWKSet, importJWK, jwtVerify, SignJWT } from "jose";
import { Clock, Effect } from "effect";
import { z } from "zod";
import { AppError } from "@tailorkit/app/client";
import type { Identity } from "@tailorkit/app/server";
import { APP_TOKEN_LIFETIME_SECONDS } from "./policy";

export type AppTokenIdentity = Omit<Identity, "expiresAt"> & {
  publicTeamId: string;
  appPublicId: string;
};
export type VerifiedAppTokenIdentity = Identity &
  Pick<AppTokenIdentity, "publicTeamId" | "appPublicId">;

export function appRuntimeIssuer(platformUrl: string) {
  const url = new URL(platformUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Platform URL requires HTTPS and no credentials, query or fragment");
  }
  return url.href.replace(/\/$/u, "");
}

export interface AppSigningOptions {
  issuer: string;
  audience: string;
  keyId: string;
  /** ES256 private key. Keep this in the trusted issuing server only. */
  privateKey: CryptoKey | JsonWebKey;
  lifetimeSeconds?: number;
  purpose: "app";
}
export interface AppTokenTrust {
  issuer: string;
  audience: string;
  purpose: "app";
  appId?: string;
  projectId?: string;
  /** Trusted issuer public keys, provisioned by the operator; never read from JWT headers. */
  publicKeys: { keys: (JsonWebKey & { kid: string })[] };
}
const access = z.object({
  publicTeamId: z.string().min(1).max(256),
  appPublicId: z.string().min(1).max(256),
  projectId: z.string().min(1).max(256),
  deploymentId: z.string().min(1).max(256),
  sub: z.string().min(1).max(256),
  subjectId: z.string().min(1).max(256).optional(),
  scope: z.object({ name: z.string().min(1), value: z.record(z.string(), z.unknown()) }),
  toolUrl: z.url(),
  purpose: z.literal("app"),
  appId: z.string().min(1).max(256),
  installationId: z.string().min(1).max(256),
  exp: z.number().int(),
  iat: z.number().int(),
});
const publicKeysSchema = z.object({
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
    .max(32),
});

export function parseAppPublicKeys(value: unknown) {
  return publicKeysSchema.parse(value);
}

function signingError(error: unknown): Error {
  return error instanceof Error ? error : new Error("App token signing failed");
}

/** Compose signing without starting a runtime; Promise callers use issueAppToken. */
export function issueAppTokenEffect(options: AppSigningOptions, identity: AppTokenIdentity) {
  return Effect.gen(function* issueToken() {
    const maximum = APP_TOKEN_LIFETIME_SECONDS;
    const lifetime = options.lifetimeSeconds ?? maximum;
    if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > maximum) {
      return yield* Effect.fail(new Error(`App tokens must last 1–${maximum} seconds`));
    }
    const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    yield* Effect.try({
      try: () =>
        access.parse({
          publicTeamId: identity.publicTeamId,
          appPublicId: identity.appPublicId,
          projectId: identity.projectId,
          deploymentId: identity.deploymentId,
          sub: identity.installationId,
          subjectId: identity.subjectId,
          scope: identity.scope,
          toolUrl: identity.toolUrl,
          purpose: options.purpose,
          appId: identity.appId,
          installationId: identity.installationId,
          iat: now,
          exp: now + lifetime,
        }),
      catch: signingError,
    });
    const key = yield* Effect.tryPromise({
      try: async () =>
        "kty" in options.privateKey
          ? await importJWK({ ...options.privateKey, alg: "ES256" }, "ES256")
          : options.privateKey,
      catch: signingError,
    });
    const token = yield* Effect.tryPromise({
      try: () =>
        new SignJWT({
          publicTeamId: identity.publicTeamId,
          appPublicId: identity.appPublicId,
          projectId: identity.projectId,
          deploymentId: identity.deploymentId,
          appId: identity.appId,
          installationId: identity.installationId,
          purpose: options.purpose,
          subjectId: identity.subjectId,
          scope: identity.scope,
          toolUrl: identity.toolUrl,
        })
          .setProtectedHeader({ alg: "ES256", kid: options.keyId, typ: "JWT" })
          .setSubject(identity.installationId)
          .setIssuer(options.issuer)
          .setAudience(options.audience)
          .setIssuedAt(now)
          .setExpirationTime(now + lifetime)
          .sign(key),
      catch: signingError,
    });
    return { token, expiresAt: (now + lifetime) * 1000 };
  });
}

export function issueAppToken(options: AppSigningOptions, identity: AppTokenIdentity) {
  return Effect.runPromise(issueAppTokenEffect(options, identity));
}

/** Trust configuration is checked at construction; token failures use the typed error channel. */
export function appTokenVerifierEffect(trust: AppTokenTrust) {
  let publicKeys;
  try {
    publicKeys = parseAppPublicKeys(trust.publicKeys);
    if (!publicKeys.keys.length) {
      throw new Error("Missing signing keys");
    }
  } catch {
    throw new Error("Configure trusted ES256 public signing keys");
  }
  const keys = createLocalJWKSet({
    keys: publicKeys.keys.map((key) => ({ ...key, alg: "ES256", use: "sig" })),
  });
  return (token: string): Effect.Effect<VerifiedAppTokenIdentity, AppError> =>
    Effect.gen(function* verifyToken() {
      const now = yield* Clock.currentTimeMillis;
      const invalidToken = () => new AppError("UNAUTHORIZED", "Invalid or expired app token");
      const { payload } = yield* Effect.tryPromise({
        try: () =>
          jwtVerify(token, keys, {
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
              "publicTeamId",
              "appPublicId",
              "scope",
              "toolUrl",
              "purpose",
            ],
            maxTokenAge: APP_TOKEN_LIFETIME_SECONDS,
            currentDate: new Date(now),
          }),
        catch: invalidToken,
      });
      const claims = yield* Effect.try({ try: () => access.parse(payload), catch: invalidToken });
      const verifiedAt = yield* Clock.currentTimeMillis;
      if (
        claims.purpose !== trust.purpose ||
        claims.sub !== claims.installationId ||
        (trust.appId !== undefined && claims.appId !== trust.appId) ||
        (trust.projectId !== undefined && claims.projectId !== trust.projectId) ||
        claims.exp <= claims.iat ||
        claims.exp - claims.iat > APP_TOKEN_LIFETIME_SECONDS ||
        claims.iat > Math.floor(verifiedAt / 1000) ||
        claims.exp * 1000 <= verifiedAt
      ) {
        return yield* Effect.fail(invalidToken());
      }
      return Object.freeze({
        publicTeamId: claims.publicTeamId,
        appPublicId: claims.appPublicId,
        projectId: claims.projectId,
        deploymentId: claims.deploymentId,
        subjectId: claims.subjectId,
        scope: Object.freeze(claims.scope),
        toolUrl: claims.toolUrl,
        appId: claims.appId,
        installationId: claims.installationId,
        expiresAt: claims.exp * 1000,
      });
    });
}

export function appTokenVerifier(trust: AppTokenTrust) {
  const verify = appTokenVerifierEffect(trust);
  return (token: string) => Effect.runPromise(verify(token));
}
export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 8192) {
    throw new AppError("UNAUTHORIZED", "App token required");
  }
  return authorization.slice(7);
}
