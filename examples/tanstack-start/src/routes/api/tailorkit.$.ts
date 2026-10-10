import { tailorKit } from "#lib/tailorkit-server";
import { createFileRoute } from "@tanstack/react-router";
import { getDemoUserFromRequest } from "@examples/shared";

const handle = ({ request }: { request: Request }) =>
  tailorKit.handler(request, {
    authenticate: ({ request }) => {
      const user = getDemoUserFromRequest(request);
      return user ? { subjectId: user.id, scopes: { user: { userId: user.id } } } : null;
    },
  });

export const Route = createFileRoute("/api/tailorkit/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
