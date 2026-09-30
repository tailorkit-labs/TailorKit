import { createAuthClient } from "better-auth/react";
import { emailOTPClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { ac, roles } from "@tailorkit/auth/lib/permissions";
import { dashClient } from "@better-auth/infra/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { captchaProtectedRoutes } from "@tailorkit/auth/lib/captcha-endpoints";
import { initBotId } from "botid/client/core";
import { deploymentHeaders } from "./deployment-headers";

// Better Auth captures fetch when creating the client, so install BotID first.
// Local development has no Vercel challenge proxy and the server allows requests.
if (typeof window !== "undefined" && import.meta.env.PROD) {
  initBotId({ protect: captchaProtectedRoutes });
}

export const authClient = createAuthClient({
  fetchOptions: { headers: typeof window === "undefined" ? {} : deploymentHeaders },
  plugins: [
    dashClient(),
    passkeyClient(),
    emailOTPClient(),
    twoFactorClient({
      twoFactorPage: "/two-factor",
    }),
    organizationClient({
      ac,
      roles,
    }),
  ],
});
