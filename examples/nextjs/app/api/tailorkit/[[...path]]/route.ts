import { tailorKit } from "@/lib/tailorkit-server";
import { getDemoUserFromRequest } from "@examples/shared";

const handle = (request: Request) =>
  tailorKit.handler(request, {
    authenticate: ({ request }) => {
      const user = getDemoUserFromRequest(request);
      return user ? { subjectId: user.id, scopes: { user: { userId: user.id } } } : null;
    },
  });

export const GET = handle;
export const POST = handle;
