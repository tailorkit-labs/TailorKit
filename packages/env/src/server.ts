import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv } from "@t3-oss/env-core";
import { vercel } from "@t3-oss/env-core/presets-zod";
import { z } from "zod";

function resolveProductionUrl(values: {
  AUTH_PRODUCTION_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}) {
  let value = values.AUTH_PRODUCTION_URL;
  if (!value && values.VERCEL_PROJECT_PRODUCTION_URL) {
    value = `https://${values.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (!value) {
    return;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return;
    }
    return url.href.replace(/\/$/u, "");
  } catch {
    // Invalid production URLs are handled by environment validation below.
  }
}

const webAppEnvDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web");

config({
  path: [resolve(webAppEnvDirectory, ".env.local"), resolve(webAppEnvDirectory, ".env")],
  quiet: true,
});

export const env = createEnv({
  createFinalSchema: (shape) =>
    z.object(shape).superRefine((values, context) => {
      if (values.EMAIL_PROVIDER === "smtp" && !values.EMAIL_SMTP_URL) {
        context.addIssue({
          code: "custom",
          message: "SMTP email requires EMAIL_SMTP_URL.",
          path: ["EMAIL_SMTP_URL"],
        });
      }

      if (
        values.EMAIL_PROVIDER === "ses" &&
        !(values.EMAIL_ACCESS_KEY_ID && values.EMAIL_SECRET_ACCESS_KEY)
      ) {
        context.addIssue({
          code: "custom",
          message: "SES email requires EMAIL_ACCESS_KEY_ID and EMAIL_SECRET_ACCESS_KEY.",
          path: ["EMAIL_ACCESS_KEY_ID", "EMAIL_SECRET_ACCESS_KEY"],
        });
      }

      if (values.BLOB_BUCKET && !(values.BLOB_ACCESS_KEY_ID && values.BLOB_SECRET_ACCESS_KEY)) {
        context.addIssue({
          code: "custom",
          message:
            "S3-compatible blob storage requires BLOB_BUCKET, BLOB_ACCESS_KEY_ID, and BLOB_SECRET_ACCESS_KEY.",
          path: ["BLOB_BUCKET", "BLOB_ACCESS_KEY_ID", "BLOB_SECRET_ACCESS_KEY"],
        });
      }

      if (
        values.KV_PROVIDER === "upstash" &&
        !(values.KV_REST_API_URL && values.KV_REST_API_TOKEN)
      ) {
        context.addIssue({
          code: "custom",
          message: "Upstash KV requires KV_REST_API_URL and KV_REST_API_TOKEN.",
          path: ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
        });
      }

      if (values.KV_PROVIDER === "redis" && !values.KV_REDIS_URL) {
        context.addIssue({
          code: "custom",
          message: "Redis KV requires KV_REDIS_URL.",
          path: ["KV_REDIS_URL"],
        });
      }

      if (Boolean(values.GITHUB_CLIENT_ID) !== Boolean(values.GITHUB_CLIENT_SECRET)) {
        context.addIssue({
          code: "custom",
          message: "GitHub OAuth requires both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
          path: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
        });
      }

      const hasGitHubCredentials = Boolean(values.GITHUB_CLIENT_ID && values.GITHUB_CLIENT_SECRET);
      if (process.env.VERCEL_ENV === "preview" && hasGitHubCredentials) {
        if (!values.OAUTH_PROXY_SECRET) {
          context.addIssue({
            code: "custom",
            message: "GitHub OAuth on Vercel previews requires OAUTH_PROXY_SECRET.",
            path: ["OAUTH_PROXY_SECRET"],
          });
        }

        if (
          !resolveProductionUrl({
            AUTH_PRODUCTION_URL: values.AUTH_PRODUCTION_URL,
            VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
          })
        ) {
          context.addIssue({
            code: "custom",
            message:
              "GitHub OAuth on Vercel previews requires AUTH_PRODUCTION_URL or VERCEL_PROJECT_PRODUCTION_URL.",
            path: ["AUTH_PRODUCTION_URL", "VERCEL_PROJECT_PRODUCTION_URL"],
          });
        }
      }
    }),
  emptyStringAsUndefined: true,
  extends: [vercel()],
  runtimeEnv: process.env,
  server: {
    // Auth
    AUTH_SECRET:
      process.env.NODE_ENV === "production" ? z.string().min(32) : z.string().min(32).optional(),
    AUTH_TRUSTED_ORIGINS: z.string().min(1).optional(),
    BETTER_AUTH_API_KEY: z.string().min(1).optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    OAUTH_PROXY_SECRET: z.string().min(32).optional(),

    // Database
    DATABASE_URL: z.string().min(1),
    AI_GATEWAY_API_KEY: z.string().min(1).optional(),

    // Deployment
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    AUTH_PRODUCTION_URL: z.url().optional(),
    PORT: z.number().optional(),

    // Observability
    OTEL_SERVICE_NAME: z.string().min(1).optional(),
    OTEL_TRACES_SAMPLER_ARG: z.string().min(1).optional(),
    TAILORKIT_OTEL_DISABLED: z.stringbool().optional(),
    TAILORKIT_OTEL_SAMPLE_RATE: z.string().min(1).optional(),

    // Email
    EMAIL_FROM: z.string().min(1),
    EMAIL_FROM_AUTH: z.string().min(1).optional(),
    EMAIL_FROM_INVITE: z.string().min(1).optional(),
    EMAIL_REPLY_TO: z.string().min(1).optional(),

    EMAIL_PROVIDER: z.enum(["ses", "smtp"]),

    EMAIL_SMTP_URL: z.string().min(1).optional(),

    EMAIL_ACCESS_KEY_ID: z.string().min(1).optional(),
    EMAIL_REGION: z.string().min(1).optional(),
    EMAIL_SECRET_ACCESS_KEY: z.string().min(1).optional(),

    // KV
    KV_PROVIDER: z.enum(["upstash", "redis"]).optional(),
    KV_REDIS_URL: z.string().min(1).optional(),
    KV_REST_API_TOKEN: z.string().min(1).optional(),
    KV_REST_API_URL: z.url().optional(),
    // Object storage
    ASSET_DOMAIN: z
      .string()
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u)
      .default("tailorkit.app"),
    ASSET_BASE_URL: z.url().optional(),
    BLOB_BUCKET: z.string().min(1).optional(),
    BLOB_ENDPOINT: z.url().optional(),
    BLOB_REGION: z.string().min(1).optional(),
    BLOB_FORCE_PATH_STYLE: z.stringbool().optional(),

    BLOB_ACCESS_KEY_ID: z.string().min(1).optional(),
    BLOB_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  },
});

export function getBaseUrl() {
  if (env.VERCEL_ENV === "production") {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (env.VERCEL_ENV === "preview") {
    return `https://${env.VERCEL_URL}`;
  }

  return `http://localhost:${env.PORT ?? 3000}`;
}

export function getTrustedOrigins() {
  const origins = new Set([getBaseUrl()]);

  for (const origin of env.AUTH_TRUSTED_ORIGINS?.split(",") ?? []) {
    const trimmedOrigin = origin.trim().replace(/\/$/u, "");
    if (trimmedOrigin) {
      origins.add(trimmedOrigin);
    }
  }

  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.add(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }

  if (env.VERCEL_ENV === "preview") {
    if (env.VERCEL_BRANCH_URL) {
      origins.add(`https://${env.VERCEL_BRANCH_URL}`);
    }

    if (env.VERCEL_URL) {
      origins.add(`https://${env.VERCEL_URL}`);
    }
  }

  return [...origins];
}

export function getProductionUrl() {
  return resolveProductionUrl(env);
}
