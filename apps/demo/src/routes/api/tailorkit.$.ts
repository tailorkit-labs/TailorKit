import { createFileRoute } from "@tanstack/react-router";
import { createTailorKit } from "tailorkit";
import { createDemoSchema } from "#lib/tailorkit";
import { env } from "#env";
import { defaultTheme } from "#lib/demo-theme";

const tailor = createTailorKit({
  basePath: "/api/tailorkit",
  ...createDemoSchema(defaultTheme),
  $internal: {
    platformBaseUrl: env.TAILORKIT_PLATFORM_BASE_URL ?? "http://localhost:3000/api/platform",
  },
});

export const Route = createFileRoute("/api/tailorkit/$")({
  server: {
    handlers: {
      GET: ({ request }) =>
        tailor.handler(request, {
          authenticate: () => ({ scopeId: "demo" }),
        }),
      POST: ({ request }) =>
        tailor.handler(request, {
          authenticate: () => ({ scopeId: "demo" }),
        }),
    },
  },
});
