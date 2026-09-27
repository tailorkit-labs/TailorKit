import { getDemoUserFromRequest } from "@examples/shared";
import { tailorKit } from "@/lib/tailorkit";

const handle = (request: Request) =>
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

export const GET = handle;
export const POST = handle;
