import type { RouterClient } from "@orpc/server";
import { appAgentRouter } from "./routes/app-agent";
import { actionRouter } from "./routes/actions";
import { appRouter } from "./routes/apps";
import { cliAuthRouter } from "./routes/cli-auth";
import { deploymentRouter } from "./routes/deployments";
import { previewRouter } from "./routes/preview";

export const tailorkitRouter = {
  appAgent: appAgentRouter,
  actions: actionRouter,
  apps: appRouter,
  cliAuth: cliAuthRouter,
  deployments: deploymentRouter,
  preview: previewRouter,
};

export type TailorKitRouter = typeof tailorkitRouter;
export type TailorKitRouterClient = RouterClient<TailorKitRouter>;
