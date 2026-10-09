import { createServer } from "tailorkit/server";
import { createDemoContract } from "#lib/tailorkit";
import { env } from "#env";
import { defaultTheme } from "#lib/demo-theme";

export const tailorKit = createServer({
  basePath: "/api/tailorkit",
  contract: createDemoContract(defaultTheme),
  $internal: {
    platformBaseUrl: env.TAILORKIT_PLATFORM_BASE_URL ?? "http://localhost:3000/api/platform",
  },
});
