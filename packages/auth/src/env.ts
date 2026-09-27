import * as z from "zod";
import { createEnv, resolveProductionUrl, warnIfMissing } from "@tailorkit/env";

export const env = createEnv({
  scope: "auth",
  schema: {
    AUTH_SECRET: z.string().min(32).optional(),
    AUTH_TRUSTED_ORIGINS: z.string().min(1).optional(),
    BETTER_AUTH_API_KEY: z.string().min(1).optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    OAUTH_PROXY_SECRET: z.string().min(32).optional(),
    AUTH_PRODUCTION_URL: z.url().optional(),
    PORT: z.coerce.number().optional(),
    VERCEL: z.stringbool().optional(),
    VERCEL_TARGET_ENV: z.string().optional(),
    VERCEL_ENV: z.string().optional(),
    VERCEL_URL: z.string().optional(),
    VERCEL_BRANCH_URL: z.string().optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  },
  warnings: {
    AUTH_SECRET: "AUTH_SECRET is not set; authentication will not work.",
  },
});

if (Boolean(env.GITHUB_CLIENT_ID) !== Boolean(env.GITHUB_CLIENT_SECRET)) {
  warnIfMissing("auth", {
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
  });
}

if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
  warnIfMissing("auth", {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  });
}

const hasSocialProvider =
  (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) ||
  (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

if (env.VERCEL_ENV === "preview" && hasSocialProvider) {
  warnIfMissing("auth", {
    OAUTH_PROXY_SECRET: env.OAUTH_PROXY_SECRET,
    AUTH_PRODUCTION_URL: resolveProductionUrl(env),
  });
}
