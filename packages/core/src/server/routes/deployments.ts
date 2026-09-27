import {
  deploymentsCreate,
  deploymentsGet,
  deploymentsList,
  deploymentsPublish,
} from "@tailorkit/client-platform/client";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { getTailorKitScope, o, requireCliDeployToken } from "../procedures";

const paginationInput = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

const clientAssetInput = z.object({
  checksum: z.string(),
  contentLength: z.number().int().min(1),
  contentType: z.literal("application/javascript"),
  encoding: z.literal("utf-8"),
  objectKey: z.literal("client.js"),
});

const logoAssetInput = z.object({
  checksum: z.string(),
  contentLength: z
    .number()
    .int()
    .min(1)
    .max(256 * 1024),
  contentType: z.enum(["image/svg+xml", "image/png", "image/webp"]),
});

const deploymentAssetsInput = z.tuple([clientAssetInput]);
const deploymentLogosInput = z
  .object({
    dark: logoAssetInput.optional(),
    light: logoAssetInput.optional(),
  })
  .optional();

const getErrorMessage = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
};

const isNotFoundError = (error: unknown): boolean =>
  getErrorMessage(error)?.toLowerCase().includes("not found") ?? false;

const preservePlatformNotFound = (error: unknown): never => {
  if (isNotFoundError(error)) {
    throw new ORPCError("NOT_FOUND", { message: "App not found." });
  }

  throw error;
};

export const deploymentRouter = {
  create: o
    .use(requireCliDeployToken)
    .input(
      z.object({ appId: z.string(), assets: deploymentAssetsInput, logos: deploymentLogosInput }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await deploymentsCreate({
          body: {
            appId: input.appId,
            assets: input.assets,
            logos: input.logos,
            scope: getTailorKitScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
        });
      } catch (error) {
        preservePlatformNotFound(error);
      }
    }),
  get: o
    .use(requireCliDeployToken)
    .input(z.object({ deploymentId: z.string() }))
    .handler(
      async ({ context, input }) =>
        await deploymentsGet({
          client: context.platform,
          headers: context.platformHeaders,
          path: { deploymentId: input.deploymentId },
          query: { scope: getTailorKitScope(context) },
        }),
    ),
  list: o
    .use(requireCliDeployToken)
    .input(z.object({ appId: z.string() }).merge(paginationInput))
    .handler(
      async ({ context, input }) =>
        await deploymentsList({
          client: context.platform,
          headers: context.platformHeaders,
          query: {
            appId: input.appId,
            page: input.page,
            pageSize: input.pageSize,
            scope: getTailorKitScope(context),
          },
        }),
    ),
  publish: o
    .use(requireCliDeployToken)
    .input(
      z.object({
        deploymentId: z.string(),
        rollout: z.boolean().optional(),
      }),
    )
    .handler(
      async ({ context, input }) =>
        await deploymentsPublish({
          body: { scope: getTailorKitScope(context), rollout: input.rollout },
          client: context.platform,
          headers: context.platformHeaders,
          path: { deploymentId: input.deploymentId },
        }),
    ),
};
