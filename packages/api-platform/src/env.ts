import * as z from "zod";
import { createEnv } from "@tailorkit/env";

export const env = createEnv({
  scope: "api-platform",
  schema: {
    APP_RUNTIME_SIGNING_KEY: z.string().optional(),
    APP_RUNTIME_PREVIOUS_PUBLIC_KEYS: z.string().optional(),
    APP_RUNTIME_SERVICE_TOKEN: z.string().min(32).optional(),
    AUTH_SECRET: z.string().min(32).optional(),
    PORT: z.coerce.number().optional(),
    VERCEL_ENV: z.string().optional(),
    VERCEL_URL: z.string().optional(),
    VERCEL_BRANCH_URL: z.string().optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
    OPENAPI_SERVER_URL: z.url().default("https://tailorkit.dev/api/platform"),
  },
  warnings: {
    AUTH_SECRET: "AUTH_SECRET is not set; authenticated platform routes will be unavailable.",
  },
});
