import { expect, it, vi, afterEach } from "vite-plus/test";
import { Effect } from "effect";
import { APP_RUNTIME_AUDIENCE } from "@tailorkit/api-utils/app-auth";
import { issueAppToken } from "@tailorkit/api-utils/app-auth";
import { createAppRuntimeVerifierEffect } from "./auth";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const issuer = "https://platform.test/api/platform";
const signing = {
  issuer,
  audience: APP_RUNTIME_AUDIENCE,
  keyId: "platform",
  privateKey: pair.privateKey,
};
const publicKeys = {
  keys: [{ ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "platform" }],
};
const identity = {
  publicTeamId: "abc123def45678",
  appPublicId: "app000000001",
  userId: "user",
  projectId: "project",
  appId: "app",
  installationId: "installation",
  deploymentId: "deployment",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("verifies configured public keys without making external requests", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const keys of [publicKeys, JSON.stringify(publicKeys)]) {
    const verify = createAppRuntimeVerifierEffect({ platformUrl: issuer, publicKeys: keys });
    const session = await issueAppToken(signing, identity);
    expect(await Effect.runPromise(verify(session.token))).toMatchObject(identity);
    expect(await Effect.runPromise(verify(session.token))).toMatchObject(identity);
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([{ issuer: "https://attacker.test" }, { audience: "other" }])(
  "rejects incorrect platform claims %j",
  async (overrides) => {
    const session = await issueAppToken({ ...signing, ...overrides }, identity);
    await expect(
      Effect.runPromise(
        createAppRuntimeVerifierEffect({ platformUrl: issuer, publicKeys })(session.token),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  },
);

it.each([undefined, "invalid", { keys: [] }, { keys: [{ kty: "oct", k: "secret", kid: "bad" }] }])(
  "fails closed for invalid configured keys %j",
  async (keys) => {
    await expect(
      Effect.runPromise(
        createAppRuntimeVerifierEffect({ platformUrl: issuer, publicKeys: keys })("token"),
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  },
);

it("exposes verification as an Effect", async () => {
  const session = await issueAppToken(signing, identity);
  expect(
    await Effect.runPromise(
      createAppRuntimeVerifierEffect({ platformUrl: issuer, publicKeys })(session.token),
    ),
  ).toMatchObject(identity);
});
