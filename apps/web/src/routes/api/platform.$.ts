import { appRuntimeKeysResponse } from "@tailorkit/api-platform/app-runtime-auth";
import { onError } from "@orpc/server";
import { createContext } from "@tailorkit/api-platform/context";
import { platformRouter } from "@tailorkit/api-platform";
import { RateLimitHandlerPlugin } from "@tailorkit/api-utils/rate-limiting";
import { createFileRoute } from "@tanstack/react-router";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import {
  initializeObservability,
  recordException,
  sanitizeErrorForLog,
  setSpanAttributes,
} from "@tailorkit/observability";

const handler = new OpenAPIHandler(platformRouter, {
  plugins: [new RateLimitHandlerPlugin()],
  interceptors: [
    onError((error) => {
      recordException(error, { "tailorkit.adapter": "orpc-openapi" });
      console.error("OpenAPI request failed", sanitizeErrorForLog(error));
    }),
  ],
});

async function handle({ request }: { request: Request }) {
  await initializeObservability("tailorkit-web");
  setSpanAttributes({
    "tailorkit.adapter": "orpc-openapi",
    "tailorkit.package": "apps-web",
  });

  if (request.method === "GET" && new URL(request.url).pathname === "/api/platform/runtime/keys")
    return appRuntimeKeysResponse();

  const context = await createContext({ request }).catch((error) => {
    recordException(error, { "tailorkit.adapter": "orpc-openapi" });
    console.error("OpenAPI authorization failed", sanitizeErrorForLog(error));
    throw new Response("Unauthorized", { status: 401 });
  });

  const rpcResult = await handler.handle(request, {
    context,
    prefix: "/api/platform",
  });

  if (rpcResult.response) {
    return rpcResult.response;
  }

  return new Response("Not found", { status: 404 });
}

export const Route = createFileRoute("/api/platform/$")({
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
