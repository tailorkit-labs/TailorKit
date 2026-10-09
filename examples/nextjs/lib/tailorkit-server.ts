import { getDemoUserFromRequest } from "@examples/shared";
import { contract } from "./tailorkit";
import { createServer } from "tailorkit/server";
import { env } from "#env";

const authenticate = ({ request }: { request: Request }) => {
  const user = getDemoUserFromRequest(request);
  return user ? { actionContext: { user }, scopes: { user: { userId: user.id } } } : null;
};

export const tailorKit = createServer({
  contract,
  assetsBaseUrl: env.TAILORKIT_ASSETS_BASE_URL,
  projectKey: env.TAILORKIT_PROJECT_KEY,
  $internal: {
    platformBaseUrl: env.TAILORKIT_PLATFORM_BASE_URL,
  },
  authenticate,
  actions: {
    echo: ({ input, context }) => `${context.user.name} said '${input}'`,
  },
});
