import { actions, components, views } from "@examples/shared";
import { createTailorKit } from "tailorkit";
import { env } from "#env";
import { z } from "zod";

export const tailorKit = createTailorKit({
  assetsBaseUrl: env.TAILORKIT_ASSETS_BASE_URL,
  projectKey: env.TAILORKIT_PROJECT_KEY,
  scopes: { user: z.object({ userId: z.string().min(1) }) },
  $internal: {
    platformBaseUrl: env.TAILORKIT_PLATFORM_BASE_URL,
  },
  actions,
  components,
  views,
  slots: {
    page: { views: ["/"], multiple: true },
    panel: { views: ["/", "/customers", "/customers/detail"] },
    navbar: { views: ["/"] },
  },
});
