// Test fixtures use promise-shaped callbacks and assertions on known fixture values.
/* eslint-disable require-await, typescript/no-non-null-assertion, unicorn/no-await-expression-member */
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, it } from "vite-plus/test";
import { bearerToken, installationKey, issueStorageToken, storageTokenVerifier } from "./auth";

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const publicKeys = { keys: [{ ...(await exportJWK(publicKey)), kid: "host-key" }] };
const signing = { issuer: "https://host.test", audience: "storage", privateKey, keyId: "host-key" };
const identity = { userId: "user", appId: "app", installationId: "installation" };
const verify = storageTokenVerifier({ ...signing, publicKeys, appId: "app" });
it("verifies host-signed identity and installation access", async () => {
  const session = await issueStorageToken(signing, identity);
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
    await issueStorageToken({ ...signing, privateKey: attacker.privateKey }, identity),
    await issueStorageToken({ ...signing, issuer: "https://attacker.test" }, identity),
    await issueStorageToken({ ...signing, audience: "other" }, identity),
    await issueStorageToken(signing, { ...identity, appId: "other" }),
  ];
  for (const { token } of invalid) {
    await expect(verify(token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT(claims)
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
  ]) {
    await expect(verify(await sign(claims))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }
  await expect(verify("not-a-token")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
it("rejects symmetric keys, private verification keys and missing bearer credentials", async () => {
  expect(() =>
    storageTokenVerifier({
      ...signing,
      appId: "app",
      publicKeys: { keys: [{ ...awaitPrivateKey, kid: "host-key" }] },
    }),
  ).toThrow("public signing keys");
  expect(() => bearerToken(new Request("https://runtime.test?token=ignored"))).toThrow("required");
  expect(() =>
    storageTokenVerifier({
      ...signing,
      appId: "app",
      publicKeys: { keys: [{ kty: "oct", k: "bad", kid: "host-key" }] },
    }),
  ).toThrow();
});
const awaitPrivateKey = await exportJWK(privateKey);
it("keeps installation routing stable and unambiguous across deployments", () => {
  expect(installationKey(identity, signing.issuer)).toBe(
    installationKey({ ...identity }, signing.issuer),
  );
  expect(installationKey({ appId: "a/b", installationId: "c" }, signing.issuer)).not.toBe(
    installationKey({ appId: "a", installationId: "b/c" }, signing.issuer),
  );
  expect(installationKey(identity, "other-host")).not.toBe(
    installationKey(identity, signing.issuer),
  );
});
it("separates operator migration tokens from ordinary app tokens", async () => {
  const { issueStorageMigrationToken, storageMigrationTokenVerifier } = await import("./auth");
  const verifyMigration = storageMigrationTokenVerifier({ ...signing, publicKeys, appId: "app" });
  const app = await issueStorageToken(signing, identity);
  const operator = await issueStorageMigrationToken(signing, identity);
  await expect(verifyMigration(app.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(verify(operator.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await verifyMigration(operator.token)).toMatchObject(identity);
});
