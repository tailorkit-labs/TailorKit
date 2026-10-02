// Test fixtures use promise-shaped callbacks and assertions on known fixture values.
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { Clock, Effect } from "effect";
import { expect, it } from "vite-plus/test";
import {
  bearerToken,
  issueAppToken,
  issueAppTokenEffect,
  appTokenVerifier,
  appTokenVerifierEffect,
} from "./tokens";

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const publicKeys = { keys: [{ ...(await exportJWK(publicKey)), kid: "host-key" }] };
const signing = {
  issuer: "https://host.test",
  audience: "tailorkit-apps-worker",
  privateKey,
  keyId: "host-key",
};
const identity = {
  publicTeamId: "abc123def45678",
  appPublicId: "app000000001",
  userId: "user",
  projectId: "project",
  deploymentId: "deployment",
  appId: "app",
  installationId: "installation",
};
const verify = appTokenVerifier({ ...signing, publicKeys, appId: "app", projectId: "project" });
it("verifies platform-signed identity and installation access", async () => {
  const session = await issueAppToken(signing, identity);
  const claims = decodeJwt(session.token);
  expect(claims.exp! - claims.iat!).toBe(300);
  expect(await verify(session.token)).toEqual({ ...identity, expiresAt: session.expiresAt });
  expect(
    bearerToken(
      new Request("https://runtime.test", {
        headers: { authorization: `Bearer ${session.token}` },
      }),
    ),
  ).toBe(session.token);
});
it("rejects wrong signature, issuer, audience, app, expiry, missing claims and excessive lifetime", async () => {
  const attacker = await generateKeyPair("ES256");
  const invalid = [
    await issueAppToken({ ...signing, privateKey: attacker.privateKey }, identity),
    await issueAppToken({ ...signing, issuer: "https://attacker.test" }, identity),
    await issueAppToken({ ...signing, audience: "other" }, identity),
    await issueAppToken(signing, { ...identity, appId: "other" }),
    await issueAppToken(signing, { ...identity, projectId: "other" }),
  ];
  for (const { token } of invalid) {
    await expect(verify(token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT({
      publicTeamId: identity.publicTeamId,
      appPublicId: identity.appPublicId,
      projectId: identity.projectId,
      deploymentId: identity.deploymentId,
      ...claims,
    })
      .setProtectedHeader({ alg: "ES256", kid: "host-key", typ: "JWT" })
      .setSubject("user")
      .setIssuer(signing.issuer)
      .setAudience(signing.audience)
      .sign(privateKey);
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { appId: "app", installationId: "installation", iat: now - 100, exp: now - 1 },
    { appId: "app", installationId: "installation", iat: now },
    { appId: "app", iat: now, exp: now + 120 },
    { appId: "app", installationId: "installation", iat: now, exp: now + 1000 },
    { appId: "app", installationId: "installation", iat: now + 60, exp: now + 120 },
    {
      appId: "app",
      installationId: "installation",
      iat: now,
      exp: now + 120,
      purpose: "migrations",
    },
  ]) {
    await expect(verify(await sign(claims))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }
  await expect(verify("not-a-token")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
it("rejects symmetric keys, private verification keys and missing bearer credentials", async () => {
  expect(() =>
    appTokenVerifier({
      ...signing,
      appId: "app",
      publicKeys: { keys: [{ ...awaitPrivateKey, kid: "host-key" }] },
    }),
  ).toThrow("public signing keys");
  expect(() => bearerToken(new Request("https://runtime.test?token=ignored"))).toThrow("required");
  expect(() =>
    appTokenVerifier({
      ...signing,
      appId: "app",
      publicKeys: { keys: [{ kty: "oct", k: "bad", kid: "host-key" }] },
    }),
  ).toThrow();
});
const awaitPrivateKey = await exportJWK(privateKey);

it("composes signing and verification with an injected clock, including expiry", async () => {
  const clock = Effect.runSync(Clock.clockWith((value) => Effect.succeed(value)));
  let now = Date.UTC(2000, 0, 1);
  const verifyEffect = appTokenVerifierEffect({ ...signing, publicKeys });
  const program = Effect.gen(function* authenticate() {
    const session = yield* issueAppTokenEffect(signing, identity);
    const access = yield* verifyEffect(session.token);
    now += 300_000;
    const expired = yield* verifyEffect(session.token).pipe(
      Effect.catch((error) => Effect.succeed(error.code)),
    );
    return { access, expiresAt: session.expiresAt, expired };
  }).pipe(
    Effect.provideService(Clock.Clock, {
      ...clock,
      currentTimeMillis: Effect.sync(() => now),
      currentTimeMillisUnsafe: () => now,
    }),
  );
  const result = await Effect.runPromise(program);
  expect(result.access).toEqual({ ...identity, expiresAt: Date.UTC(2000, 0, 1) + 300_000 });
  expect(result.expiresAt).toBe(result.access.expiresAt);
  expect(result.expired).toBe("UNAUTHORIZED");
});

it("keeps invalid signing configuration in the recoverable Effect error channel", async () => {
  const program = issueAppTokenEffect({ ...signing, lifetimeSeconds: 301 }, identity).pipe(
    Effect.catch((error) => Effect.succeed(error.message)),
  );
  await expect(Effect.runPromise(program)).resolves.toBe("App tokens must last 1–300 seconds");
});

it("rejects a token that expires while its signature is being verified", async () => {
  const session = await issueAppToken(signing, identity);
  const clock = Effect.runSync(Clock.clockWith((value) => Effect.succeed(value)));
  let reads = 0;
  const program = appTokenVerifierEffect({ ...signing, publicKeys })(session.token).pipe(
    Effect.provideService(Clock.Clock, {
      ...clock,
      currentTimeMillis: Effect.sync(() =>
        ++reads === 1 ? session.expiresAt - 1 : session.expiresAt,
      ),
    }),
    Effect.catch((error) => Effect.succeed(error.code)),
  );
  await expect(Effect.runPromise(program)).resolves.toBe("UNAUTHORIZED");
});

it.each(["projectId", "deploymentId", "publicTeamId", "appPublicId"])(
  "requires the signed %s claim",
  async (field) => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { ...identity, [field]: undefined, iat: now, exp: now + 120 };
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "host-key", typ: "JWT" })
      .setSubject(identity.userId)
      .setIssuer(signing.issuer)
      .setAudience(signing.audience)
      .sign(privateKey);
    await expect(verify(token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  },
);
