import { ORPCError, os } from "@orpc/server";
import { devDelayMiddleware } from "@tailorkit/api-utils/dev-delay";
import { createRatelimiter, ratelimitMiddleware } from "@tailorkit/api-utils/rate-limiting";
import { setSpanAttributes } from "@tailorkit/observability";
import type { Context } from "./context";
import { db } from "@tailorkit/db";
import { type Scope } from "@tailorkit/db/schema/scope";
import { canonicalizeScope, canonicalizeScopes } from "./scope";

const rateLimiter = createRatelimiter({ maxRequests: 100, window: 1000 });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const o = os.$context<Context>().$route({
  inputStructure: "detailed",
  outputStructure: "detailed",
});

export const protectedRouter = o
  .use(devDelayMiddleware)
  .use(ratelimitMiddleware(rateLimiter, ({ context }) => context.organization.id));

export const requireApp = o.middleware(
  async ({ context, next }, input: { appId: string; scope: Scope }) => {
    setSpanAttributes({
      "tailorkit.middleware": "require_app",
      "tailorkit.package": "api-platform",
      "tailorkit.resource_type": "app",
    });

    const { scope, scopeKey } = canonicalizeScope(input.scope);
    const appById = uuidPattern.test(input.appId)
      ? await db.query.app.findFirst({
          where: {
            RAW: (fields, { and, eq }) =>
              and(
                eq(fields.id, input.appId),
                eq(fields.projectId, context.project.id),
                eq(fields.scopeKey, scopeKey),
                eq(fields.scope, scope),
              )!,
          },
          with: { currentDeployment: { where: { status: "published" } } },
        })
      : null;
    const app =
      appById ??
      (await db.query.app.findFirst({
        where: {
          RAW: (fields, { and, eq }) =>
            and(
              eq(fields.projectId, context.project.id),
              eq(fields.publicId, input.appId),
              eq(fields.scopeKey, scopeKey),
              eq(fields.scope, scope),
            )!,
        },
        with: { currentDeployment: { where: { status: "published" } } },
      }));

    if (!app) {
      throw new ORPCError("NOT_FOUND");
    }

    return next({ context: { ...context, app } });
  },
);

export const requireAppInScopes = o.middleware(
  async ({ context, next }, input: { appId: string; scopes: Scope[] }) => {
    setSpanAttributes({
      "tailorkit.middleware": "require_app",
      "tailorkit.package": "api-platform",
      "tailorkit.resource_type": "app",
    });

    const scopes = canonicalizeScopes(input.scopes);
    const appById = uuidPattern.test(input.appId)
      ? await db.query.app.findFirst({
          where: {
            RAW: (fields, { and, eq, or }) =>
              and(
                eq(fields.id, input.appId),
                eq(fields.projectId, context.project.id),
                or(
                  ...scopes.map(({ scope, scopeKey }) =>
                    and(eq(fields.scopeKey, scopeKey), eq(fields.scope, scope)),
                  ),
                ),
              )!,
          },
          with: { currentDeployment: { where: { status: "published" } } },
        })
      : null;
    const app =
      appById ??
      (await db.query.app.findFirst({
        where: {
          RAW: (fields, { and, eq, or }) =>
            and(
              eq(fields.projectId, context.project.id),
              eq(fields.publicId, input.appId),
              or(
                ...scopes.map(({ scope, scopeKey }) =>
                  and(eq(fields.scopeKey, scopeKey), eq(fields.scope, scope)),
                ),
              ),
            )!,
        },
        with: { currentDeployment: { where: { status: "published" } } },
      }));

    if (!app) {
      throw new ORPCError("NOT_FOUND");
    }

    return next({ context: { ...context, app } });
  },
);
