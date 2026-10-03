import * as z from "zod";
import { createEnv } from "@tailorkit/env";

export const env = createEnv({
  scope: "api",
  schema: { VERCEL_ENV: z.string().optional() },
});
