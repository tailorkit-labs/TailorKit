import { initBotId } from "botid/client/core";
import { withBotId } from "botid/next/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { captchaEndpoints } from "@tailorkit/auth/lib/captcha-endpoints";
import vercelConfig from "../../vercel.json";

vi.mock("botid/client/core", () => ({ initBotId: vi.fn() }));

describe("auth client BotID initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(initBotId).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses BotID's patched fetch for sign-in requests in production", async () => {
    const originalFetch = vi.fn();
    const protectedFetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { message: "Invalid credentials", code: "INVALID_EMAIL_OR_PASSWORD" },
          { status: 401 },
        ),
      );
    vi.stubGlobal("window", { location: new URL("https://tailorkit.dev/login") });
    vi.stubGlobal("fetch", originalFetch);
    vi.stubEnv("PROD", true);
    vi.mocked(initBotId).mockImplementation(() => {
      vi.stubGlobal("fetch", protectedFetch);
    });

    const { authClient } = await import("./auth-client");
    await authClient.signIn.email({ email: "user@example.com", password: "test-password" });

    expect(initBotId).toHaveBeenCalledWith({
      protect: captchaEndpoints.map((path) => ({ path: `/api/auth${path}`, method: "POST" })),
    });
    expect(protectedFetch).toHaveBeenCalledOnce();
    expect(String(protectedFetch.mock.calls[0]?.[0])).toBe(
      "https://tailorkit.dev/api/auth/sign-in/email",
    );
    expect(originalFetch).not.toHaveBeenCalled();
  });

  it("does not load browser challenges during local development", async () => {
    vi.stubGlobal("window", { location: new URL("http://localhost:3000/login") });
    vi.stubEnv("PROD", false);

    await import("./auth-client");

    expect(initBotId).not.toHaveBeenCalled();
  });

  it("does not initialize BotID during server rendering", async () => {
    vi.stubEnv("PROD", true);
    vi.stubGlobal("window", undefined);

    await import("./auth-client");

    expect(initBotId).not.toHaveBeenCalled();
  });
});

describe("BotID proxy configuration", () => {
  it("includes the installed SDK's rewrites and security headers", async () => {
    const sdkConfig = withBotId({});
    const rewrites = await sdkConfig.rewrites?.();
    const headers = await sdkConfig.headers?.();

    expect(Array.isArray(rewrites)).toBe(true);
    expect(vercelConfig.rewrites).toEqual(expect.arrayContaining(rewrites as unknown[]));
    expect(vercelConfig.headers).toEqual(expect.arrayContaining(headers ?? []));
  });
});
