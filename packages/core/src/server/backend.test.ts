// Test fixtures use promise-shaped callbacks and assertions on known fixture values.
/* eslint-disable require-await, typescript/no-non-null-assertion, unicorn/no-await-expression-member */
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { handleBackendSession } from "./backend";

const session = { token: "platform-issued-token", expiresAt: 123, url: "https://runtime.test/rpc" };
const issueSession = vi.fn(async () => session);
const authenticate = vi.fn(async () => ({ scopes: { workspace: { id: "authorized-workspace" } } }));
const request = (body: unknown, origin = "https://host.test") =>
  new Request("https://host.test/api/tailorkit/backend/session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin },
  });

beforeEach(() => vi.clearAllMocks());

it("uses existing host authentication and passes only verified scopes to the platform", async () => {
  const input = request({ appId: "installed-app" });
  const response = await handleBackendSession(input, authenticate, issueSession);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(session);
  expect(authenticate).toHaveBeenCalledWith({ request: input });
  expect(issueSession).toHaveBeenCalledExactlyOnceWith(
    "installed-app",
    {
      workspace: { id: "authorized-workspace" },
    },
    undefined,
  );
});

it("rejects unauthenticated requests before issuing tokens", async () => {
  const response = await handleBackendSession(
    request({ appId: "app" }),
    async () => null,
    issueSession,
  );
  expect(response.status).toBe(401);
  expect(issueSession).not.toHaveBeenCalled();
});

it.each([
  { appId: "app", installationId: "victim" },
  { appId: "app", subjectId: "victim" },
  { appId: "app", scopes: { workspace: { id: "victim" } } },
  { appId: "app", url: "https://attacker.test/rpc" },
  { appId: "" },
  { appId: 1 },
  { appId: "x".repeat(257) },
  null,
])("rejects invalid or forged session input %j", async (body) => {
  const response = await handleBackendSession(request(body), authenticate, issueSession);
  expect(response.status).toBe(400);
  expect(issueSession).not.toHaveBeenCalled();
});

it("rejects cross-origin requests before authenticating or issuing tokens", async () => {
  const response = await handleBackendSession(
    request({ appId: "app" }, "https://attacker.test"),
    authenticate,
    issueSession,
  );
  expect(response.status).toBe(400);
  expect(authenticate).not.toHaveBeenCalled();
  expect(issueSession).not.toHaveBeenCalled();
});

it.each(["GET", "PUT"])("rejects %s session requests", async (method) => {
  const response = await handleBackendSession(
    new Request("https://host.test/api/tailorkit/backend/session", { method }),
    authenticate,
    issueSession,
  );
  expect(response.status).toBe(400);
  expect(issueSession).not.toHaveBeenCalled();
});

it("bounds chunked session request bodies", async () => {
  const response = await handleBackendSession(
    request({ appId: "x".repeat(4096) }),
    authenticate,
    issueSession,
  );
  expect(response.status).toBe(413);
  expect(issueSession).not.toHaveBeenCalled();
});

it("rejects malformed JSON", async () => {
  const response = await handleBackendSession(
    new Request("https://host.test/api/tailorkit/backend/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
    authenticate,
    issueSession,
  );
  expect(response.status).toBe(400);
  expect(issueSession).not.toHaveBeenCalled();
});
