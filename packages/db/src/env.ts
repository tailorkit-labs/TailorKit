import * as z from "zod";
import { createEnv } from "@tailorkit/env";

export const env = createEnv({
  scope: "db",
  schema: { DATABASE_URL: z.url().optional() },
  warnings: {
    DATABASE_URL: "DATABASE_URL is not set; database connections will be unavailable.",
  },
});
