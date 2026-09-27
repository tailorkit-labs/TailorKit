import { getDemoUserFromRequest } from "@examples/shared";
import { tailorKit } from "#lib/tailorkit";
import { createFileRoute } from "@tanstack/react-router";

const handle = ({ request }: { request: Request }) =>
  tailorKit.handler(request, {
    authenticate: () => {
      const user = getDemoUserFromRequest(request);

      if (!user) {
        return null;
      }

      return {
        actionContext: { user },
        scope: { userId: user.id },
      };
    },
  });

export const Route = createFileRoute("/api/tailorkit/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});
