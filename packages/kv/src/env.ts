import * as z from "zod";
import { createEnv, warnIfMissing } from "@tailorkit/env";

export const env = createEnv({
  scope: "kv",
  schema: {
    KV_PROVIDER: z.enum(["upstash", "redis"]).optional(),
    KV_REDIS_URL: z.url({ protocol: /^rediss?$/u }).optional(),
    KV_REST_API_TOKEN: z.string().min(1).optional(),
    KV_REST_API_URL: z.url({ protocol: /^https?$/u }).optional(),
  },
});

if (env.KV_PROVIDER === "upstash") {
  warnIfMissing("kv", {
    KV_REST_API_URL: env.KV_REST_API_URL,
    KV_REST_API_TOKEN: env.KV_REST_API_TOKEN,
  });
}
if (env.KV_PROVIDER === "redis") {
  warnIfMissing("kv", { KV_REDIS_URL: env.KV_REDIS_URL });
}
