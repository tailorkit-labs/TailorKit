import { createFileRoute } from "@tanstack/react-router";
import { tailorKit } from "#lib/tailorkit-server";

export const Route = createFileRoute("/api/tailorkit/$")({
  server: {
    handlers: {
      GET: ({ request }) =>
        tailorKit.handler(request, {
          authenticate: () => ({ scopes: { demo: { demoId: "demo" } } }),
        }),
      POST: ({ request }) =>
        tailorKit.handler(request, {
          authenticate: () => ({ scopes: { demo: { demoId: "demo" } } }),
        }),
    },
  },
});
