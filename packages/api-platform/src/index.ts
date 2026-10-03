import type { RouterClient } from "@orpc/server";

import { appRouter } from "./routes/apps";
import { cliAuthRouter } from "./routes/cli-auth";
import { deploymentRouter } from "./routes/deployments";
import { previewRouter } from "./routes/preview";

export const platformRouter = {
  apps: appRouter,
  cliAuth: cliAuthRouter,
  deployments: deploymentRouter,
  preview: previewRouter,
};

export type PlatformRouter = typeof platformRouter;
export type PlatformRouterClient = RouterClient<PlatformRouter>;
