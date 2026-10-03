import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { createContext } from "@tailorkit/api/context";
import { appRouter } from "@tailorkit/api/routers/index";
import { RateLimitHandlerPlugin } from "@tailorkit/api-utils/rate-limiting";
import {
  initializeObservability,
  recordException,
  sanitizeErrorForLog,
  setSpanAttributes,
} from "@tailorkit/observability";
import { createFileRoute } from "@tanstack/react-router";

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      recordException(error, { "tailorkit.adapter": "orpc-rpc" });
      console.error("oRPC request failed", sanitizeErrorForLog(error));
    }),
  ],
  plugins: [new RateLimitHandlerPlugin()],
});

async function handle({ request }: { request: Request }) {
  await initializeObservability("tailorkit-web");
  setSpanAttributes({
    "tailorkit.adapter": "orpc-rpc",
    "tailorkit.package": "apps-web",
  });

  const rpcResult = await rpcHandler.handle(request, {
    context: await createContext({ request }),
    prefix: "/api/rpc",
  });
  if (rpcResult.response) {
    return rpcResult.response;
  }

  return new Response("Not found", { status: 404 });
}

export const Route = createFileRoute("/api/rpc/$")({
  server: {
    handlers: {
      DELETE: handle,
      GET: handle,
      HEAD: handle,
      PATCH: handle,
      POST: handle,
      PUT: handle,
    },
  },
});
