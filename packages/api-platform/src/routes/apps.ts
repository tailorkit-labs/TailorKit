import { publishRuntimeMetadata, runtimeSession } from "./runtime";
import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { db } from "@tailorkit/db";
import { App, app, AppDeployment } from "@tailorkit/db/schema/apps";
import { eq } from "drizzle-orm";
import z from "zod";
import { paginatedOutput, paginationQuery } from "../pagination";
import { o, protectedRouter, requireApp, requireAppInScopes } from "../procedures";
import { createPublicId } from "../public-id";
import { withAppAssetUrl } from "../asset-url";
import { canonicalizeScope, canonicalizeScopes, scopeSchema, scopesSchema } from "../scope";

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
  .meta(
    openapi({
      path: "/apps/list",
      method: "POST",
    }),
  )
  .input(z.object({ body: paginationQuery.extend({ scopes: scopesSchema }) }))
  .output(paginatedOutput(AppWithCurrentDeployment))
  .handler(async ({ context, input }) => {
    const { page, pageSize } = input.body;
    const scopes = canonicalizeScopes(input.body.scopes);
    const apps = await db.query.app.findMany({
      where: {
        RAW: (fields, { and, eq, or }) =>
          and(
            eq(fields.projectId, context.project.id),
            or(
              ...scopes.map(({ scope, scopeKey }) =>
                and(eq(fields.scopeKey, scopeKey), eq(fields.scope, scope)),
              ),
            ),
          ) ?? eq(fields.projectId, context.project.id),
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
  .meta(
    openapi({
      path: "/apps/{appId}/lookup",
      method: "POST",
    }),
  )
  .input(
    z.object({
      params: z.object({ appId: z.string() }),
      body: z.object({ scopes: scopesSchema }),
    }),
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(
    requireAppInScopes.adaptInput(({ params: { appId }, body: { scopes } }) => ({ appId, scopes })),
  )
  .handler(({ context }) => ({
    body: withAppAssetUrl(context.app, context.organization.publicId, context.project.id),
  }));

const createApp = protectedRouter
  .meta(
    openapi({
      path: "/apps",
      method: "POST",
    }),
  )
  .input(
    z.object({
      body: App.pick({ name: true, description: true }).extend({ scope: scopeSchema }),
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
  .meta(
    openapi({
      path: "/apps/{appId}",
      method: "DELETE",
    }),
  )
  .input(
    z.object({
      params: z.object({ appId: z.string() }),
      body: z.object({ scope: scopeSchema }),
    }),
  )
  .output(z.object({ body: z.object({ id: z.uuid({ version: "v7" }) }) }))
  .use(requireApp.adaptInput(({ params: { appId }, body: { scope } }) => ({ appId, scope })))
  .handler(async ({ context }) => {
    await db.delete(app).where(eq(app.id, context.app.id));

    return { body: { id: context.app.id } };
  });

const updateApp = protectedRouter
  .meta(
    openapi({
      path: "/apps/{appId}",
      method: "PUT",
    }),
  )
  .input(
    z.object({
      body: App.pick({ name: true, description: true }).extend({ scope: scopeSchema }),
      params: z.object({ appId: z.string() }),
    }),
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(requireApp.adaptInput(({ params: { appId }, body: { scope } }) => ({ appId, scope })))
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
  .meta(
    openapi({
      path: "/apps/{appId}/deploy",
      method: "POST",
    }),
  )
  .input(
    z.object({
      body: z.object({ deploymentId: z.string(), scope: scopeSchema }),
      params: z.object({ appId: z.string() }),
    }),
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(requireApp.adaptInput(({ params: { appId }, body: { scope } }) => ({ appId, scope })))
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

    if (deployment.status === "published") {
      const server = await db.query.appDeploymentFile.findFirst({
        where: {
          appDeploymentId: deployment.id,
          status: "verified",
          objectKey: `teams/${context.organization.publicId}/projects/${context.project.id}/apps/${context.app.publicId}/deployments/${deployment.publicId}/server/server.js`,
        },
      });
      if (server?.checksum) {
        await publishRuntimeMetadata({
          projectId: context.project.id,
          appId: context.app.id,
          deploymentId: deployment.id,
          objectKey: server.objectKey,
          checksum: server.checksum,
          contentLength: server.contentLength,
        });
      }
    }

    return {
      body: withAppAssetUrl(
        { ...updatedApp, currentDeployment: deployment },
        context.organization.publicId,
        context.project.id,
      ),
    };
  });

export const appRouter = o.router({
  runtimeSession,
  list: listApps,
  get: getApp,
  create: createApp,
  delete: deleteApp,
  update: updateApp,
  deploy,
});
