import * as z from "zod";
import { createEnv } from "@tailorkit/env";

export const env = createEnv({
  scope: "web",
  schema: {
    VERCEL_DEPLOYMENT_ID: z.string().optional(),
    VERCEL_ENV: z.string().optional(),
    VERCEL_SKEW_PROTECTION_ENABLED: z.string().optional(),
  },
});
