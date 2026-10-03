import { os } from "@orpc/server";
import { env } from "#env";
import { setSpanAttributes } from "@tailorkit/observability";

export const devDelayMiddleware = os.middleware(async ({ path, next }) => {
  const start = Date.now();

  if (env.NODE_ENV === "development") {
    // artificial delay in dev 100-500ms
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  setSpanAttributes({
    "tailorkit.package": "api-utils",
    "tailorkit.orpc.path": path,
    "tailorkit.duration_ms": end - start,
  });

  return result;
});
