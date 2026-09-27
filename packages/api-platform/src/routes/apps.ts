import { ORPCError } from "@orpc/server";
import { db } from "@tailorkit/db";
import { App, app, AppDeployment } from "@tailorkit/db/schema/apps";
import { scopeValueSchema } from "@tailorkit/db/schema/scope";
import { eq } from "drizzle-orm";
import z from "zod";
import { paginatedOutput, paginationQuery } from "../pagination";
import { o, protectedRouter, requireApp } from "../procedures";
import { createPublicId } from "../public-id";
import { withAppAssetUrl } from "../asset-url";
import { canonicalizeScope } from "../scope";

export const AppWithCurrentDeployment = App.omit({ scopeKey: true }).extend({
  currentDeployment: AppDeployment.nullable(),
  clientPath: z.url().optional(),
  logoPaths: z.object({ dark: z.url().optional(), light: z.url().optional() }).optional(),
});
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function createUniqueAppPublicId(projectId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const publicId = createPublicId();
    const existing = await db.query.app.findFirst({
      where: { projectId, publicId },
    });

    if (!existing) {
      return publicId;
    }
  }

  throw new ORPCError("BAD_REQUEST", { message: "Failed to create app id." });
}

const listApps = protectedRouter
  .route({
    path: "/",
    method: "GET",
  })
  .input(z.object({ query: paginationQuery.extend({ scope: scopeValueSchema }) }))
  .output(paginatedOutput(AppWithCurrentDeployment))
  .handler(async ({ context, input }) => {
    const { page, pageSize } = input.query;
    const scope = canonicalizeScope(input.query.scope);
    const apps = await db.query.app.findMany({
      where: {
        RAW: (fields, { and, eq }) =>
          and(
            eq(fields.projectId, context.project.id),
            eq(fields.scopeKey, scope.scopeKey),
            eq(fields.scope, scope.scope),
          )!,
      },
      orderBy: {
        createdAt: "desc",
      },
      with: {
        currentDeployment: {
          where: {
            status: "published",
          },
        },
      },
      limit: pageSize + 1,
      offset: (page - 1) * pageSize,
    });

    return {
      body: {
        items: apps
          .slice(0, pageSize)
          .map((item) => withAppAssetUrl(item, context.organization.publicId, context.project.id)),
        pagination: {
          hasMore: apps.length > pageSize,
          page,
          pageSize,
        },
      },
    };
  });

const getApp = protectedRouter
  .route({
    path: "/:appId",
    method: "GET",
  })
  .input(
    z.object({
      params: z.object({ appId: z.string() }),
      query: z.object({
        scope: scopeValueSchema,
      }),
    }),
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(requireApp, ({ params: { appId }, query: { scope } }) => ({ appId, scope }))
  .handler(({ context }) => ({
    body: withAppAssetUrl(context.app, context.organization.publicId, context.project.id),
  }));

const createApp = protectedRouter
  .route({
    path: "/",
    method: "POST",
  })
  .input(
    z.object({
      body: App.pick({ name: true, description: true }).extend({ scope: scopeValueSchema }),
    }),
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .handler(async ({ context, input }) => {
    const scope = canonicalizeScope(input.body.scope);
    const [createdApp] = await db
      .insert(app)
      .values({
        description: input.body.description?.trim() || undefined,
        name: input.body.name.trim(),
        projectId: context.project.id,
        publicId: await createUniqueAppPublicId(context.project.id),
        scopeKey: scope.scopeKey,
        scope: scope.scope,
      })
      .returning();

    if (!createdApp) {
      throw new ORPCError("BAD_REQUEST", { message: "Failed to create app." });
    }

    return {
      body: {
        ...createdApp,
        currentDeployment: null,
      },
    };
  });

const deleteApp = protectedRouter
  .route({
    path: "/:appId",
    method: "DELETE",
  })
  .input(
    z.object({
      params: z.object({ appId: z.string() }),
      query: z.object({ scope: scopeValueSchema }),
    }),
  )
  .output(z.object({ body: z.object({ id: z.uuid({ version: "v7" }) }) }))
  .use(requireApp, ({ params: { appId }, query: { scope } }) => ({ appId, scope }))
  .handler(async ({ context }) => {
    await db.delete(app).where(eq(app.id, context.app.id));

    return { body: { id: context.app.id } };
  });

const updateApp = protectedRouter
  .route({
    path: "/:appId",
    method: "PUT",
  })
  .input(
    z.object({
      body: App.pick({ name: true, description: true }),
      params: z.object({ appId: z.string() }),
      query: z.object({ scope: scopeValueSchema }),
    }),
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(requireApp, ({ params: { appId }, query: { scope } }) => ({ appId, scope }))
  .handler(async ({ context, input }) => {
    const [updatedApp] = await db
      .update(app)
      .set({
        description:
          input.body.description === undefined ? undefined : input.body.description?.trim() || null,
        name: input.body.name?.trim(),
      })
      .where(eq(app.id, context.app.id))
      .returning();

    if (!updatedApp) {
      throw new ORPCError("BAD_REQUEST", { message: "Failed to update app." });
    }

    return {
      body: {
        ...updatedApp,
        currentDeployment: null,
      },
    };
  });

const deploy = protectedRouter
  .route({
    path: "/:appId/deploy",
    method: "POST",
  })
  .input(
    z.object({
      body: z.object({ deploymentId: z.string() }),
      params: z.object({ appId: z.string() }),
      query: z.object({ scope: scopeValueSchema }),
    }),
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(requireApp, ({ params: { appId }, query: { scope } }) => ({ appId, scope }))
  .handler(async ({ context, input }) => {
    const deploymentByPublicId = await db.query.appDeployment.findFirst({
      where: {
        appId: context.app.id,
        publicId: input.body.deploymentId,
      },
    });
    const deployment =
      deploymentByPublicId ??
      (uuidPattern.test(input.body.deploymentId)
        ? await db.query.appDeployment.findFirst({
            where: {
              appId: context.app.id,
              id: input.body.deploymentId,
            },
          })
        : null);

    if (!deployment) {
      throw new ORPCError("NOT_FOUND", { message: "Deployment not found." });
    }

    const [updatedApp] = await db
      .update(app)
      .set({ currentDeploymentId: deployment.id })
      .where(eq(app.id, context.app.id))
      .returning();

    if (!updatedApp) {
      throw new ORPCError("BAD_REQUEST", { message: "Failed to deploy app." });
    }

    return {
      body: withAppAssetUrl(
        { ...updatedApp, currentDeployment: deployment },
        context.organization.publicId,
        context.project.id,
      ),
    };
  });

export const appRouter = o.prefix("/apps").router({
  list: listApps,
  get: getApp,
  create: createApp,
  delete: deleteApp,
  update: updateApp,
  deploy,
});
