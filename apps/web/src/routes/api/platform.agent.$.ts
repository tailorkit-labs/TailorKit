import { getVercelOidcToken } from "@vercel/oidc";
import { handleAgentRequest } from "@tailorkit/api-platform/agent";
import { createContext } from "@tailorkit/api-platform/context";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "#env";

async function handle({ request }: { request: Request }) {
  const context = await createContext({ request }).catch(() => null);
  if (!context) return new Response("Unauthorized", { status: 401 });

  return handleAgentRequest(request, context, {
    eveUrl: env.TAILORKIT_EVE_URL ?? new URL(request.url).origin,
    oidcToken: process.env.VERCEL === "1" ? await getVercelOidcToken() : undefined,
  });
}

export const Route = createFileRoute("/api/platform/agent/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
