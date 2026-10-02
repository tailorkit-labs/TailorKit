// Test fixtures use promise-shaped callbacks and assertions on known fixture values.
/* eslint-disable require-await, typescript/no-non-null-assertion, unicorn/no-await-expression-member */
import { expect, it, vi } from "vite-plus/test";
import { handleBackendSession as rawHandleBackendSession } from "./backend";

const issueSession = vi.fn(async () => ({
  token: "platform-issued-token",
  expiresAt: Date.now() + 120_000,
}));
const handleBackendSession = (
  request: Parameters<typeof rawHandleBackendSession>[0],
  options: Parameters<typeof rawHandleBackendSession>[1],
  authenticate: Parameters<typeof rawHandleBackendSession>[2],
) => rawHandleBackendSession(request, options, authenticate, issueSession);
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
  new Request("https://host.test/api/tailorkit/backend/session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin },
  });
const authenticate = async () => ({ scopes: { workspace: { id: "authorized-workspace" } } });
it("issues a short-lived token only after host authorization using verified scopes", async () => {
  const response = await handleBackendSession(
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
    (await handleBackendSession(request({ appId: "installed-app" }), options, async () => null))
      .status,
  ).toBe(401);
  expect(
    (await handleBackendSession(request({ appId: "not-installed" }), options, authenticate)).status,
  ).toBe(403);
  expect(
    (
      await handleBackendSession(
        request({ appId: "installed-app", installationId: "victim" }),
        options,
        authenticate,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handleBackendSession(
        request({ appId: "installed-app" }, "https://attacker.test"),
        options,
        authenticate,
      )
    ).status,
  ).toBe(400);
});

it.each(["not a URL", "http://runtime.test/rpc", "ftp://localhost/rpc"])(
  "returns an uncached configuration error for runtime URL %s",
  async (url) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const issue = vi.fn();
    try {
      const response = await rawHandleBackendSession(
        request({ appId: "installed-app" }),
        {
          resolveInstallation: () => ({
            appId: "installed-app",
            userId: "user",
            installationId: "installation",
            url,
          }),
        },
        authenticate,
        issue,
      );
      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(log).toHaveBeenCalledOnce();
      expect(issue).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  },
);
it.each([
  "https://runtime.test/rpc",
  "http://localhost/rpc",
  "http://127.0.0.1/rpc",
  "http://[::1]/rpc",
])("accepts runtime URL %s", async (url) => {
  const response = await handleBackendSession(
    request({ appId: "installed-app" }),
    {
      resolveInstallation: () => ({
        appId: "installed-app",
        userId: "user",
        installationId: "installation",
        url,
      }),
    },
    authenticate,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
