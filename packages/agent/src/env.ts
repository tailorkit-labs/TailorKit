import { createEnv } from "@tailorkit/env";
import * as z from "zod";

export const env = createEnv({
  scope: "agent",
  schema: {
    DATABASE_URL: z.string().min(1).optional(),
    VERCEL_ENV: z.string().optional(),
  },
  warnings: {
    DATABASE_URL: "DATABASE_URL is not set; agent persistence will be unavailable.",
  },
});
