import { handlePublicRuntimeRequest } from "@tailorkit/api-platform/routes/runtime";
import { onError, ORPCError } from "@orpc/server";
import { createCliContext, createContext } from "@tailorkit/api-platform/context";
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

// CLI credentials must never reach the host's project-key authenticated routes.
const cliHandler = new OpenAPIHandler(
  { cli: platformRouter.cli },
  {
    plugins: [new RateLimitHandlerPlugin()],
  },
);

async function handle({ request }: { request: Request }) {
  await initializeObservability("tailorkit-web");
  setSpanAttributes({
    "tailorkit.adapter": "orpc-openapi",
    "tailorkit.package": "apps-web",
  });

  const publicResponse = handlePublicRuntimeRequest(request);
  if (publicResponse) return publicResponse;

  const isCli = new URL(request.url).pathname.startsWith("/api/platform/cli/");
  const context = await (isCli ? createCliContext({ request }) : createContext({ request })).catch(
    (error) => {
      recordException(error, { "tailorkit.adapter": "orpc-openapi" });
      console.error("OpenAPI authorization failed", sanitizeErrorForLog(error));
      if (isCli) {
        throw Response.json(
          {
            code: error instanceof ORPCError ? error.code : "UNAUTHORIZED",
            message: error instanceof ORPCError ? error.message : "Invalid CLI deploy token.",
          },
          {
            status: error instanceof ORPCError && error.code === "SERVICE_UNAVAILABLE" ? 503 : 401,
          },
        );
      }
      throw new Response("Unauthorized", { status: 401 });
    },
  );

  const rpcResult = await (isCli ? cliHandler : handler).handle(request, {
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
