import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ getKV: vi.fn() }));
vi.mock("@tailorkit/kv", () => ({ getKV: mocks.getKV }));
vi.mock("#env", () => ({ env: { NODE_ENV: "test" } }));

const { createRateLimiter, ratelimitMiddleware, RateLimitHandlerPlugin } =
  await import("./rate-limiting");

beforeEach(() => {
  mocks.getKV.mockReset().mockReturnValue(null);
});

it("uses the existing ioredis connection with prefixed keys and a millisecond window", async () => {
  const evalScript = vi.fn().mockResolvedValue([2, 900]);
  mocks.getKV.mockReturnValue({ type: "redis", engine: { eval: evalScript } });
  const limiter = createRateLimiter({ maxRequests: 3, window: 1000 });

  await expect(limiter.limit("user:1", { weight: 2 })).resolves.toMatchObject({
    success: true,
    limit: 3,
    remaining: 1,
  });
  expect(evalScript).toHaveBeenCalledWith(
    expect.any(String),
    1,
    "tailorkit:ratelimit:user:1",
    "2",
    "1000",
  );

  evalScript.mockResolvedValueOnce([4, 900]);
  await expect(limiter.limit("user:1", { weight: 2 })).resolves.toMatchObject({
    success: false,
    remaining: 0,
  });
});

it("deduplicates the limiter per request and returns HTTP 429 with retry headers", async () => {
  const limiter = createRateLimiter({ maxRequests: 1, window: 60_000 });
  const limit = vi.spyOn(limiter, "limit");
  const middleware = ratelimitMiddleware(limiter, () => "user:1");
  const handler = new RPCHandler(
    {
      ping: os
        .use(middleware)
        .use(middleware)
        .handler(() => "pong"),
    },
    { plugins: [new RateLimitHandlerPlugin()] },
  );
  const request = () =>
    new Request("https://example.com/rpc/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: null }),
    });

  const first = await handler.handle(request(), { prefix: "/rpc", context: {} });
  expect(first.response?.status).toBe(200);
  expect(first.response?.headers.get("ratelimit-limit")).toBe("1");
  expect(limit).toHaveBeenCalledTimes(1);

  const second = await handler.handle(request(), { prefix: "/rpc", context: {} });
  expect(second.response?.status).toBe(429);
  expect(second.response?.headers.get("ratelimit-remaining")).toBe("0");
  expect(Number(second.response?.headers.get("retry-after"))).toBeGreaterThan(0);
});
