import { createAuthClient } from "better-auth/react";
import { emailOTPClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { ac, roles } from "@tailorkit/auth/lib/permissions";
import { dashClient } from "@better-auth/infra/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { deploymentHeaders } from "./deployment-headers";

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
