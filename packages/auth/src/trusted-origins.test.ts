import { betterAuth } from "better-auth/minimal";
import { describe, expect, it } from "vite-plus/test";

describe("AUTH_TRUSTED_ORIGINS preview pattern", () => {
  it("trusts only previews with the TailorKit project prefix", async () => {
    const auth = betterAuth({
      baseURL: "https://tailorkit.dev",
      secret: "test-secret-with-at-least-32-characters",
      trustedOrigins: ["https://tailorkit-*.vercel.app"],
    });
    const context = await auth.$context;

    expect(context.isTrustedOrigin("https://tailorkit-feature-auth.vercel.app")).toBe(true);
    expect(context.isTrustedOrigin("https://another-project-feature-auth.vercel.app")).toBe(false);
  });
});
