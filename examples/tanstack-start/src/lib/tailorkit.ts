import { actions, components, contexts } from "@examples/shared";
import { createTailorKit } from "tailorkit";
import { env } from "#env";
import { z } from "zod";

export const tailorKit = createTailorKit({
  assetsBaseUrl: env.TAILORKIT_ASSETS_BASE_URL,
  projectKey: env.TAILORKIT_PROJECT_KEY,
  scopeSchema: z.object({ userId: z.string().min(1) }),
  $internal: {
    platformBaseUrl: env.TAILORKIT_PLATFORM_BASE_URL,
  },
  actions,
  components,
  contexts,
  slots: {
    panel: { views: ["/", "/customers", "/customers/detail"] },
    navbar: { views: ["/"] },
  },
});
