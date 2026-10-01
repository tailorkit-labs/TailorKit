// Test fixtures use promise-shaped callbacks and assertions on known fixture values.
/* eslint-disable require-await, typescript/no-non-null-assertion, unicorn/no-await-expression-member */
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, it } from "vite-plus/test";
import { bearerToken, issueAppToken, appTokenVerifier } from "./auth";

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const publicKeys = { keys: [{ ...(await exportJWK(publicKey)), kid: "host-key" }] };
const signing = {
  issuer: "https://host.test",
  audience: "tailorkit-apps-runtime",
  privateKey,
  keyId: "host-key",
};
const identity = {
  userId: "user",
  projectId: "project",
  deploymentId: "deployment",
  appId: "app",
  installationId: "installation",
};
const verify = appTokenVerifier({ ...signing, publicKeys, appId: "app", projectId: "project" });
it("verifies platform-signed identity and installation access", async () => {
  const session = await issueAppToken(signing, identity);
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
    new SignJWT({ projectId: identity.projectId, deploymentId: identity.deploymentId, ...claims })
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

it.each(["projectId", "deploymentId"])("requires the signed %s claim", async (field) => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...identity, [field]: undefined, iat: now, exp: now + 120 };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "host-key", typ: "JWT" })
    .setSubject(identity.userId)
    .setIssuer(signing.issuer)
    .setAudience(signing.audience)
    .sign(privateKey);
  await expect(verify(token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
