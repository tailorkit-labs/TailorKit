import {
  appsCreate,
  appsDelete,
  appsDeploy,
  appsGet,
  appsList,
  appsUpdate,
} from "@tailorkit/client-platform/client";
import { z } from "zod";
import { getTailorKitScope, o, requireCliDeployToken } from "../procedures";

const paginationInput = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

const appInput = z.object({
  description: z.string().nullable(),
  name: z.string(),
});

export const appRouter = {
  create: o
    .use(requireCliDeployToken)
    .input(appInput)
    .handler(
      async ({ context, input }) =>
        await appsCreate({
          body: { ...input, scope: getTailorKitScope(context) },
          client: context.platform,
          headers: context.platformHeaders,
        }),
    ),
  delete: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDelete({
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
          query: { scope: getTailorKitScope(context) },
        }),
    ),
  deploy: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string(), deploymentId: z.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDeploy({
          body: { deploymentId: input.deploymentId },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
          query: { scope: getTailorKitScope(context) },
        }),
    ),
  get: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string() }))
    .handler(
      async ({ context, input }) =>
        await appsGet({
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
          query: { scope: getTailorKitScope(context) },
        }),
    ),
  list: o
    .use(requireCliDeployToken)
    .input(paginationInput.optional())
    .handler(
      async ({ context, input }) =>
        await appsList({
          client: context.platform,
          headers: context.platformHeaders,
          query: {
            page: input?.page,
            pageSize: input?.pageSize,
            scope: getTailorKitScope(context),
          },
        }),
    ),
  update: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string() }).extend(appInput.shape))
    .handler(
      async ({ context, input }) =>
        await appsUpdate({
          body: {
            description: input.description,
            name: input.name,
          },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
          query: { scope: getTailorKitScope(context) },
        }),
    ),
};
