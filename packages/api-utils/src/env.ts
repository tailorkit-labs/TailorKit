import * as z from "zod";
import { createEnv } from "@tailorkit/env";

export const env = createEnv({
  scope: "api-utils",
  schema: {
    NODE_ENV: z.enum(["development", "production", "test"]).optional(),
    VERCEL: z.stringbool().optional(),
    VERCEL_ENV: z.string().optional(),
    PORT: z.coerce.number().optional(),
    VERCEL_URL: z.string().optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
    ASSET_DOMAIN: z.string().default("tailorkit.app"),
    ASSET_BASE_URL: z.url().optional(),
  },
});
