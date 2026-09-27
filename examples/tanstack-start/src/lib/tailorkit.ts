import { actions, components, contexts } from "@examples/shared";
import { createTailorKit } from "tailorkit";
import { env } from "#env";

export const tailorKit = createTailorKit({
  assetsBaseUrl: env.TAILORKIT_ASSETS_BASE_URL,
  projectKey: env.TAILORKIT_PROJECT_KEY,
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
