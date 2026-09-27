import { createRatelimitMiddleware } from "@orpc/experimental-ratelimit";
import { MemoryRatelimiter } from "@orpc/experimental-ratelimit/memory";
import { RedisRatelimiter } from "@orpc/experimental-ratelimit/redis";
import { UpstashRatelimiter } from "@orpc/experimental-ratelimit/upstash-ratelimit";
import { Ratelimit } from "@upstash/ratelimit";
import { getKV } from "@tailorkit/kv";
import type { Ratelimiter } from "@orpc/experimental-ratelimit";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";
import { env } from "#env";
import type { Context, Meta, MiddlewareOptions } from "@orpc/server";

export { RatelimitHandlerPlugin } from "@orpc/experimental-ratelimit";

export function createRatelimiter({
  maxRequests,
  window,
}: {
  maxRequests: number;
  window: number;
}): Ratelimiter {
  const kv = getKV();

  if (kv?.type === "upstash") {
    const ratelimit = new Ratelimit({
      redis: kv.engine,
      limiter: Ratelimit.slidingWindow(maxRequests, `${window} ms`),
      prefix: "tailorkit:ratelimit:",
    });
    return new UpstashRatelimiter(ratelimit, {
      waitUntil: env.VERCEL ? vercelWaitUntil : undefined,
    });
  }

  if (kv?.type === "redis") {
    return new RedisRatelimiter({
      eval: (script, numKeys, ...rest) => kv.engine.eval(script, numKeys, ...rest) as never,
      maxRequests,
      window,
      prefix: "tailorkit:ratelimit:",
    });
  }

  return new MemoryRatelimiter({ maxRequests, window });
}

export const ratelimitMiddleware = <
  TInContext extends Context,
  TInput = unknown,
  TMeta extends Meta = Record<never, never>,
>(
  limiter: Ratelimiter,
  key: (
    options: MiddlewareOptions<TInContext, unknown, Record<never, never>, TMeta>,
    input: TInput,
  ) => string,
) =>
  createRatelimitMiddleware<TInContext, TInput, TMeta>({
    limiter,
    key,
  });
