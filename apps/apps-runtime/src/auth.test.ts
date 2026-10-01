import { expect, it, vi, afterEach } from "vite-plus/test";
import { APP_RUNTIME_AUDIENCE, issueAppToken } from "@tailorkit/apps-server/auth";
import { verifier } from "./auth";

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

it("fetches only the configured platform's keys and caches completed keys for repeat verification", async () => {
  const fetcher = vi.fn(async () => Response.json(publicKeys));
  vi.stubGlobal("fetch", fetcher);
  const verify = verifier({ PLATFORM_URL: `${issuer}/` });
  const session = await issueAppToken(signing, identity);
  expect(await verify(session.token)).toMatchObject(identity);
  expect(await verify(session.token)).toMatchObject(identity);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith(
    `${issuer}/runtime/keys`,
    expect.objectContaining({ redirect: "manual", credentials: "omit" }),
  );
});

it.each([{ issuer: "https://attacker.test" }, { audience: "other" }])(
  "rejects incorrect platform claims %j",
  async (overrides) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(publicKeys)),
    );
    const session = await issueAppToken({ ...signing, ...overrides }, identity);
    await expect(verifier({ PLATFORM_URL: issuer })(session.token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  },
);

it("does not follow redirects or accept unavailable keys", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://attacker.test/keys" } }),
    ),
  );
  await expect(verifier({ PLATFORM_URL: issuer })("token")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
});

it("rejects unsigned and wrongly signed tokens", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(publicKeys)),
  );
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const session = await issueAppToken({ ...signing, privateKey: other.privateKey }, identity);
  const verify = verifier({ PLATFORM_URL: issuer });
  await expect(verify(session.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(verify("unsigned.token.value")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("refreshes cached platform keys after a minute", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json(publicKeys));
  vi.stubGlobal("fetch", fetcher);
  const verify = verifier({ PLATFORM_URL: issuer });
  const session = await issueAppToken(signing, identity);
  await verify(session.token);
  vi.setSystemTime(Date.now() + 60_001);
  await verify(session.token);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("rejects private key material returned by the key endpoint", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ keys: [{ ...publicKeys.keys[0], d: "private" }] })),
  );
  await expect(verifier({ PLATFORM_URL: issuer })("token")).rejects.toThrow();
});
