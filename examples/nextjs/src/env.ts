import * as z from "zod";
import { createEnv } from "@tailorkit/env";

export const env = createEnv({
  scope: "example-nextjs",
  schema: {
    TAILORKIT_BASE_URL: z.url().default("http://localhost:5020/api/tailorkit"),
    TAILORKIT_PROJECT_KEY: z.string().min(1).optional(),
    TAILORKIT_PLATFORM_BASE_URL: z.url().default("http://localhost:3000/api/platform"),
  },
  warnings: {
    TAILORKIT_PROJECT_KEY: "TAILORKIT_PROJECT_KEY is not set; Tailorkit assets will not load.",
  },
});
