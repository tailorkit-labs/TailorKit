import { createDb } from "@tailorkit/db";
import * as schema from "@tailorkit/db/schema/auth";
import { sendBetterAuthOtpEmail, sendOrganizationInvitationEmail } from "@tailorkit/email";
import { getBaseUrl, getProductionUrl, getTrustedOrigins } from "@tailorkit/env";
import { env } from "#env";
import { getKV } from "@tailorkit/kv";
import { initializeObservability } from "@tailorkit/observability";
import type { SecondaryStorage } from "better-auth";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";
import { haveIBeenPwned } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { organization } from "better-auth/plugins/organization";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { twoFactor } from "better-auth/plugins/two-factor";
import { ac, roles } from "./lib/permissions";
import { apiKey } from "@better-auth/api-key";
import { dash } from "@better-auth/infra";
import { passkey } from "@better-auth/passkey";
import { initializePublicTeamId, publicTeamIdField } from "./lib/public-team-id";

void initializeObservability("tailorkit-web");

const noopWaitUntil = (promise: Promise<unknown>) => void promise;

// Better Auth only challenges credential sign-ins by default. Intercept direct
// and OAuth-proxy callbacks before their newly created sessions become usable,
// then issue the same short-lived challenge used by the two-factor plugin.
const enforceTwoFactorAfterSocialSignIn = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/callback/:id" && ctx.path !== "/oauth-proxy-callback") {
    return;
  }

  const newSession = ctx.context.newSession;
  const user = newSession?.user as { id: string; twoFactorEnabled?: boolean } | undefined;

  if (!newSession || !user?.twoFactorEnabled) {
    return;
  }

  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(newSession.session.token);
  ctx.context.setNewSession(null);

  const maxAge = 600;
  const twoFactorCookie = ctx.context.createAuthCookie("two_factor", { maxAge });
  const identifier = `2fa-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + maxAge * 1000);

  await ctx.context.internalAdapter.createVerificationValue({
    expiresAt,
    identifier,
    value: user.id,
  });
  await ctx.context.internalAdapter.createVerificationValue({
    expiresAt,
    identifier: `2fa-attempts-${identifier}`,
    value: "0",
  });
  await ctx.setSignedCookie(
    twoFactorCookie.name,
    identifier,
    ctx.context.secret,
    twoFactorCookie.attributes,
  );

  return ctx.redirect(new URL("/two-factor", getBaseUrl(env)).toString());
});

const createSecondaryStorage = (): SecondaryStorage | undefined => {
  const kv = getKV();

  if (!kv) {
    return;
  }

  return {
    delete: (key: string) => kv.delete(key),
    get: (key: string) => kv.get(key),
    getAndDelete: (key: string) => kv.getAndDelete(key),
    increment: (key: string, ttl: number) => kv.increment(key, ttl),
    set: (key: string, value: string, ttl?: number) => kv.set(key, value, { ttl }),
  };
};

function buildAuth() {
  const db = createDb();

  const backgroundTaskHandler = env.VERCEL ? vercelWaitUntil : noopWaitUntil;
  const secondaryStorage = createSecondaryStorage();
  const productionUrl = getProductionUrl(env);

  return betterAuth({
    appName: "TailorKit",
    account: {
      encryptOAuthTokens: true,
    },
    advanced: {
      backgroundTasks: {
        handler: backgroundTaskHandler,
      },
      cookiePrefix: env.VERCEL_TARGET_ENV === "production" ? "tailorkit" : "tailorkit-dev",
      database: {
        generateId: "uuid",
        joins: true,
      },
      ipAddress: {
        ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
      },
    },
    baseURL: getBaseUrl(env),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
      transaction: true,
    }),
    // Better Auth still resolves the session model through the DB adapter in
    // some auth flows when secondaryStorage is configured.
    session: {
      storeSessionInDatabase: true,
    },
    secondaryStorage,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: false,
    },
    hooks: {
      after: enforceTwoFactorAfterSocialSignIn,
    },
    onAPIError: {
      // Keep OAuth failures in the application instead of Better Auth's
      // development-oriented default error page.
      errorURL: "/auth/error",
    },
    socialProviders: {
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
              scope: ["user:email"],
            },
          }
        : {}),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    plugins: [
      haveIBeenPwned(),
      passkey({
        rpName: "TailorKit",
      }),
      twoFactor({
        // OAuth-only accounts must create a password through the verified-email
        // recovery flow before they can enroll a second factor.
        allowPasswordless: false,
        issuer: "TailorKit",
      }),
      emailOTP({
        expiresIn: 600,
        overrideDefaultEmailVerification: true,
        sendVerificationOnSignUp: false,
        sendVerificationOTP: ({ email, otp, type }) => {
          backgroundTaskHandler(sendBetterAuthOtpEmail({ email, otp, type }));
          return Promise.resolve();
        },
        storeOTP: "hashed",
      }),
      organization({
        ac,
        allowUserToCreateOrganization: false,
        roles,
        organizationHooks: {
          beforeCreateOrganization: ({ organization }) =>
            Promise.resolve(initializePublicTeamId(organization)),
        },
        sendInvitationEmail: async (data) => {
          await sendOrganizationInvitationEmail({
            email: data.email,
            invitationId: data.id,
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
            role: data.role,
          });
        },
        schema: {
          organization: {
            additionalFields: {
              publicId: publicTeamIdField,
              slug: {
                type: "string",
                fieldName: "slug",
                unique: true,
                required: true,
              },
            },
          },
        },
      }),
      apiKey({
        configId: "project-host",
        defaultPrefix: "tk_proj_",
        enableMetadata: true,
        keyExpiration: {
          defaultExpiresIn: null,
          maxExpiresIn: 3650,
          minExpiresIn: 0,
        },
        references: "organization",
        ...(secondaryStorage
          ? {
              fallbackToDatabase: true,
              storage: "secondary-storage" as const,
            }
          : {
              storage: "database" as const,
            }),
      }),
      ...(env.BETTER_AUTH_API_KEY
        ? [
            dash({
              apiKey: env.BETTER_AUTH_API_KEY,
            }),
          ]
        : []),
      ...(productionUrl && env.OAUTH_PROXY_SECRET
        ? [
            oAuthProxy({
              productionURL: productionUrl,
              secret: env.OAUTH_PROXY_SECRET,
            }),
          ]
        : []),
      tanstackStartCookies(),
    ],
    secret: env.AUTH_SECRET,
    trustedOrigins: getTrustedOrigins(env),
    user: {
      additionalFields: {
        theme: {
          defaultValue: "system",
          fieldName: "theme",
          required: false,
          type: "string",
        },
      },
    },
  });
}

export function createAuth(): ReturnType<typeof buildAuth> {
  return buildAuth();
}

export const auth: ReturnType<typeof buildAuth> = createAuth();

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
