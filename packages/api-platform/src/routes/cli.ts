import { openapi } from "@orpc/openapi";
import { call, ORPCError } from "@orpc/server";
import { App, AppDeployment } from "@tailorkit/db/schema/apps";
import { z } from "zod";
import { o } from "../procedures";
import { scopeSchema } from "../scope";
import { appRouter, AppWithCurrentDeployment } from "./apps";
import { createDeploymentInput, createDeploymentOutput, deploymentRouter } from "./deployments";

const cli = o.use(async ({ context, next }) => {
  const { cliToken, ...projectContext } = context;
  if (!cliToken || context.runtimeService) throw new ORPCError("UNAUTHORIZED");
  if (cliToken.projectId !== context.project.id) throw new ORPCError("UNAUTHORIZED");
  return next({ context: { ...context, projectContext, scope: cliToken.scope } });
});

export const cliRouter = o.meta(openapi({ prefix: "/cli" })).router({
  verify: cli
    .meta(openapi({ path: "/verify", method: "POST" }))
    .input(z.object({ body: z.strictObject({}) }))
    .output(z.object({ body: z.object({ projectId: z.string(), scope: scopeSchema }) }))
    .handler(({ context }) => ({
      body: { projectId: context.project.id, scope: context.scope },
    })),
  appsCreate: cli
    .meta(openapi({ path: "/apps", method: "POST" }))
    .input(z.object({ body: App.pick({ name: true, description: true }).strict() }))
    .output(z.object({ body: AppWithCurrentDeployment }))
    .handler(({ input, context }) =>
      call(
        appRouter.create,
        { body: { ...input.body, scope: context.scope } },
        {
          context: context.projectContext,
        },
      ),
    ),
  deploymentsCreate: cli
    .meta(openapi({ path: "/deployments", method: "POST" }))
    .input(z.object({ body: z.strictObject(createDeploymentInput.shape).omit({ scope: true }) }))
    .output(createDeploymentOutput)
    .handler(({ input, context }) =>
      call(
        deploymentRouter.create,
        { body: { ...input.body, scope: context.scope } },
        {
          context: context.projectContext,
        },
      ),
    ),
  deploymentsPublish: cli
    .meta(openapi({ path: "/deployments/{deploymentId}", method: "POST" }))
    .input(
      z.object({
        params: z.object({ deploymentId: z.string() }),
        body: z.strictObject({ rollout: z.boolean().optional().default(true) }),
      }),
    )
    .output(z.object({ body: AppDeployment }))
    .handler(({ input, context }) =>
      call(
        deploymentRouter.publish,
        {
          params: input.params,
          body: { ...input.body, scope: context.scope },
        },
        { context: context.projectContext },
      ),
    ),
});
