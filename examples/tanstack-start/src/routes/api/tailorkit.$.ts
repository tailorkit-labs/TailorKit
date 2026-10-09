import { tailorKit } from "#lib/tailorkit-server";
import { createFileRoute } from "@tanstack/react-router";

const handle = ({ request }: { request: Request }) => tailorKit.handler(request);

export const Route = createFileRoute("/api/tailorkit/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
