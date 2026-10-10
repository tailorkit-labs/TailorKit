import { contract } from "./tailorkit";
import { createServer } from "tailorkit/server";
import { env } from "#env";

if (!env.TAILORKIT_BASE_URL) {
  throw new Error("TAILORKIT_BASE_URL must be a valid public HTTP(S) URL.");
}

export const tailorKit = createServer({
  contract,
  baseUrl: env.TAILORKIT_BASE_URL,
  projectKey: env.TAILORKIT_PROJECT_KEY,
  $internal: {
    platformBaseUrl: env.TAILORKIT_PLATFORM_BASE_URL,
  },
  tools: {
    echo: ({ input, context }) => `${context.identity.subjectId} said '${input}'`,
  },
});
