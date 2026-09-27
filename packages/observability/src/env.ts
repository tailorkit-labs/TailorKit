import * as z from "zod";
import { createEnv } from "@tailorkit/env";

export const env = createEnv({
  scope: "observability",
  schema: {
    NODE_ENV: z.enum(["development", "production", "test"]).optional(),
    VERCEL: z.stringbool().optional(),
    VERCEL_ENV: z.string().optional(),
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),
    VERCEL_REGION: z.string().optional(),
    OTEL_SERVICE_NAME: z.string().min(1).optional(),
    OTEL_TRACES_SAMPLER_ARG: z.string().min(1).optional(),
    TAILORKIT_OTEL_DISABLED: z.stringbool().optional(),
    TAILORKIT_OTEL_SAMPLE_RATE: z.string().min(1).optional(),
  },
});
