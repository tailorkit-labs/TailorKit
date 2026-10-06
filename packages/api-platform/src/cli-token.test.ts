import { hashSecret } from "@tailorkit/api-utils/hashing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { canonicalizeScope } from "./scope";

const mocks = vi.hoisted(() => ({
  findToken: vi.fn(),
  env: { AUTH_SECRET: "test-cli-token-secret" as string | undefined },
}));
vi.mock("@tailorkit/db", () => ({ db: { query: { cliToken: { findFirst: mocks.findToken } } } }));
vi.mock("#env", () => ({ env: mocks.env }));
const { authenticateCli } = await import("./cli-token");
const canonical = canonicalizeScope({ name: "org", value: { tenant: "one", environment: "dev" } });

function validToken() {
  return {
    id: "cli-one",
    projectId: "project-one",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    scope: { name: "org", value: { tenant: "one", environment: "dev" } },
    scopeKey: canonical.scopeKey,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
  mocks.env.AUTH_SECRET = "test-cli-token-secret";
  mocks.findToken.mockResolvedValue(validToken());
});
afterEach(() => vi.useRealTimers());

describe("shared platform CLI token authentication", () => {
  it("binds token lookup to the project and hashed credential and returns canonical scope", async () => {
    const token = await authenticateCli("project-one", "deploy-token");
    expect(mocks.findToken).toHaveBeenCalledWith({
      where: {
        projectId: "project-one",
        tokenHash: hashSecret("deploy-token", mocks.env.AUTH_SECRET!),
      },
    });
    expect(token).toEqual({
      ...validToken(),
      scope: canonical.scope,
      scopeKey: canonical.scopeKey,
    });
  });

  it.each([
    ["missing", undefined],
    ["revoked", { revokedAt: new Date() }],
    ["expired", { expiresAt: new Date(0) }],
    ["expires exactly now", { expiresAt: new Date("2026-10-06T00:00:00Z") }],
    ["malformed scope", { scope: { name: "org", value: {} } }],
    ["mismatched scope key", { scopeKey: "0".repeat(32) }],
  ])("rejects a %s token", async (_name, overrides) => {
    mocks.findToken.mockResolvedValueOnce(
      overrides ? { ...validToken(), ...overrides } : undefined,
    );
    await expect(authenticateCli("project-one", "deploy-token")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid CLI deploy token.",
    });
  });

  it("rejects runtime credentials before reading tokens", async () => {
    await expect(authenticateCli("project-one", "deploy-token", true)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.findToken).not.toHaveBeenCalled();
  });

  it("reports missing auth configuration before reading tokens", async () => {
    mocks.env.AUTH_SECRET = undefined;
    await expect(authenticateCli("project-one", "deploy-token")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(mocks.findToken).not.toHaveBeenCalled();
  });
});
