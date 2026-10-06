import {
  appsCreate,
  appsDelete,
  appsDeploy,
  appsGet,
  appsList,
  appsUpdate,
} from "@tailorkit/client-platform/client";
import { z } from "zod";
import { getTailorKitScope, getTailorKitScopes, o, requireCliDeployToken } from "../procedures";

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
    .handler(async ({ context, input }) => {
      const { data } = await appsCreate({
        responseStyle: "fields",
        throwOnError: true,
        body: { ...input, scope: getTailorKitScope(context) },
        client: context.platform,
        headers: context.platformHeaders,
      });
      return data;
    }),
  delete: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDelete({
          body: { scope: getTailorKitScope(context) },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
        }),
    ),
  deploy: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string(), deploymentId: z.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDeploy({
          body: { deploymentId: input.deploymentId, scope: getTailorKitScope(context) },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
        }),
    ),
  get: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string(), scopes: z.array(z.string()).optional() }))
    .handler(
      async ({ context, input }) =>
        await appsGet({
          body: { scopes: getTailorKitScopes(context, input.scopes) },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
        }),
    ),
  list: o
    .use(requireCliDeployToken)
    .input(paginationInput.extend({ scopes: z.array(z.string()).optional() }).optional())
    .handler(async ({ context, input }) => {
      const { data } = await appsList({
        responseStyle: "fields",
        throwOnError: true,
        client: context.platform,
        headers: context.platformHeaders,
        body: {
          page: input?.page,
          pageSize: input?.pageSize,
          scopes: getTailorKitScopes(context, input?.scopes),
        },
      });
      return data;
    }),
  update: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string() }).extend(appInput.shape))
    .handler(
      async ({ context, input }) =>
        await appsUpdate({
          body: {
            description: input.description,
            name: input.name,
            scope: getTailorKitScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
        }),
    ),
};
