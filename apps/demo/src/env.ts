import * as z from "zod";
import { createEnv } from "@tailorkit/env";

export const env = createEnv({
  scope: "demo",
  schema: { TAILORKIT_PLATFORM_BASE_URL: z.url().optional() },
});
