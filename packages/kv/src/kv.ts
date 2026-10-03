import { env } from "#env";
import { createRedisKV } from "./redis.js";
import { createUpstashKV } from "./upstash.js";
import type { KV } from "./types.js";

type KVInstance = KV<"upstash"> | KV<"redis"> | null;

let instance: KVInstance | undefined;

function createKV(): KVInstance {
  if (env.KV_PROVIDER === "upstash") {
    return createUpstashKV();
  }

  if (env.KV_PROVIDER === "redis") {
    if (!env.KV_REDIS_URL) {
      throw new Error("KV_REDIS_URL is required when KV_PROVIDER is redis");
    }

    return createRedisKV(env.KV_REDIS_URL);
  }

  return null;
}

export function getKV(): KVInstance {
  if (instance !== undefined) {
    return instance;
  }

  instance = createKV();
  return instance;
}
