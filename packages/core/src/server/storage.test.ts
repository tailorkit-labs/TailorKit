// Test fixtures use promise-shaped callbacks and assertions on known fixture values.
/* eslint-disable require-await, typescript/no-non-null-assertion, unicorn/no-await-expression-member */
import { expect, it, vi } from "vite-plus/test";
import { storageTokenVerifier } from "@tailorkit/app-storage/auth";
import { handleStorageSession } from "./storage";

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const options = {
  privateKey,
  keyId: "host-key",
  issuer: "https://host.test",
  audience: "storage",
  resolveInstallation: vi.fn(({ appId }: { appId: string }) =>
    appId === "installed-app"
      ? {
          appId,
          userId: "verified-user",
          installationId: "host-installation",
          url: "https://runtime.test/rpc",
        }
      : null,
  ),
};
const request = (body: unknown, origin = "https://host.test") =>
  new Request("https://host.test/api/tailorkit/storage/session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin },
  });
const authenticate = async () => ({ scopes: { workspace: { id: "authorized-workspace" } } });
it("issues a short-lived token only after host authorization using verified scopes", async () => {
  const response = await handleStorageSession(
    request({ appId: "installed-app" }),
    options,
    authenticate,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const session = await response.json();
  const verify = storageTokenVerifier({
    ...options,
    appId: "installed-app",
    publicKeys: {
      keys: [{ ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "host-key" }],
    },
  });
  expect(await verify(session.token)).toMatchObject({
    userId: "verified-user",
    installationId: "host-installation",
    appId: "installed-app",
  });
  expect(options.resolveInstallation).toHaveBeenCalledWith(
    expect.objectContaining({ scopes: { workspace: { id: "authorized-workspace" } } }),
  );
});
it("rejects unauthenticated requests, uninstalled apps, forged store IDs and cross-origin token requests", async () => {
  expect(
    (await handleStorageSession(request({ appId: "installed-app" }), options, async () => null))
      .status,
  ).toBe(401);
  expect(
    (await handleStorageSession(request({ appId: "not-installed" }), options, authenticate)).status,
  ).toBe(403);
  expect(
    (
      await handleStorageSession(
        request({ appId: "installed-app", installationId: "victim" }),
        options,
        authenticate,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handleStorageSession(
        request({ appId: "installed-app" }, "https://attacker.test"),
        options,
        authenticate,
      )
    ).status,
  ).toBe(400);
});
