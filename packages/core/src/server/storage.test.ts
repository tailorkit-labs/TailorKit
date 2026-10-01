// Test fixtures use promise-shaped callbacks and assertions on known fixture values.
/* eslint-disable require-await, typescript/no-non-null-assertion, unicorn/no-await-expression-member */
import { expect, it, vi } from "vite-plus/test";
import { handleStorageSession as rawHandleStorageSession } from "./storage";

const issueSession = vi.fn(async () => ({
  token: "platform-issued-token",
  expiresAt: Date.now() + 120_000,
}));
const handleStorageSession = (
  request: Parameters<typeof rawHandleStorageSession>[0],
  options: Parameters<typeof rawHandleStorageSession>[1],
  authenticate: Parameters<typeof rawHandleStorageSession>[2],
) => rawHandleStorageSession(request, options, authenticate, issueSession);
const options = {
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
  expect(session.token).toBe("platform-issued-token");
  expect(issueSession).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "verified-user",
      installationId: "host-installation",
      appId: "installed-app",
    }),
    { workspace: { id: "authorized-workspace" } },
  );
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
