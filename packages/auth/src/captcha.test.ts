import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth/minimal";
import { checkBotId } from "botid/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { authCaptcha } from "./lib/captcha";
import { authBasePath, captchaProtectedRoutes } from "./lib/captcha-endpoints";

vi.mock("botid/server", () => ({ checkBotId: vi.fn() }));

const options: BetterAuthOptions = {
  baseURL: "https://tailorkit.dev",
  basePath: authBasePath,
  secret: "test-secret-with-at-least-32-characters",
  logger: { disabled: true },
  plugins: [authCaptcha],
};
const auth = betterAuth(options);

const humanVerdict = {
  isHuman: true,
  isBot: false,
  isVerifiedBot: false,
  bypassed: false,
};

describe("auth captcha", () => {
  beforeEach(() => {
    vi.mocked(checkBotId).mockReset();
  });

  it.each(captchaProtectedRoutes)("rejects bots on $method $path", async ({ path, method }) => {
    vi.mocked(checkBotId).mockResolvedValue({ ...humanVerdict, isHuman: false, isBot: true });

    const response = await auth.handler(new Request(`https://tailorkit.dev${path}`, { method }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "VERIFICATION_FAILED" });
    expect(checkBotId).toHaveBeenCalledOnce();
  });

  it.each(captchaProtectedRoutes)("allows humans on $method $path", async ({ path, method }) => {
    vi.mocked(checkBotId).mockResolvedValue(humanVerdict);

    const result = await authCaptcha.onRequest(
      new Request(`https://tailorkit.dev${path}`, { method }),
      await auth.$context,
    );

    expect(result).toBeUndefined();
    expect(checkBotId).toHaveBeenCalledOnce();
  });

  it("rejects verified bots as well", async () => {
    vi.mocked(checkBotId).mockResolvedValue({
      ...humanVerdict,
      isHuman: false,
      isBot: true,
      isVerifiedBot: true,
    });

    const response = await auth.handler(
      new Request("https://tailorkit.dev/api/auth/sign-in/email", { method: "POST" }),
    );

    expect(response.status).toBe(403);
  });

  it("fails closed if BotID verification is unavailable", async () => {
    vi.mocked(checkBotId).mockRejectedValue(new Error("BotID unavailable"));

    const response = await auth.handler(
      new Request("https://tailorkit.dev/api/auth/sign-up/email", { method: "POST" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "UNKNOWN_ERROR" });
  });

  it.each(["/get-session", "/callback/google", "/oauth-proxy-callback", "/api-key/verify"])(
    "does not challenge %s",
    async (path) => {
      const result = await authCaptcha.onRequest(
        new Request(`https://tailorkit.dev${authBasePath}${path}`),
        await auth.$context,
      );

      expect(result).toBeUndefined();
      expect(checkBotId).not.toHaveBeenCalled();
    },
  );
});
