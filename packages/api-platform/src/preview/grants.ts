import { openapi } from "@orpc/openapi";
import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { db } from "@tailorkit/db";
import z from "zod";
import { withAppAssetUrl } from "../asset-url";
import { protectedRouter } from "../procedures";
import { createPreviewViewerToken } from "./token";
import { previewWebSocketUrl, requirePreviewKV } from "./runtime";
import { ensurePreviewDeveloperGrace } from "./lifecycle";
import { AppWithCurrentDeployment } from "../routes/apps";
import {
  canonicalizeScope,
  canonicalizeScopes,
  scopeMatches,
  scopeSchema,
  scopesSchema,
} from "../scope";

const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const createId = () => randomBytes(32).toString("base64url");
const grantKey = (id: string) => `preview:grant:${id}`;
const grantSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.uuid(),
  scope: scopeSchema,
});
type Grant = z.infer<typeof grantSchema>;

export const invitation = protectedRouter
  .meta(openapi({ path: "/shares/{shareId}", method: "GET" }))
  .input(z.object({ params: z.object({ shareId: opaqueId }) }))
  .output(
    z.object({ body: z.object({ appName: z.string(), expiresAt: z.date(), sessionId: z.uuid() }) }),
  )
  .handler(async ({ context, input }) => {
    const kv = requirePreviewKV();
    const session = await db.query.previewSession.findFirst({
      where: { shareId: input.params.shareId, projectId: context.project.id, status: "active" },
      with: { app: true },
    });
    if (
      !session ||
      !session.app ||
      session.expiresAt <= new Date() ||
      !(await ensurePreviewDeveloperGrace(kv, session.id))
    ) {
      throw new ORPCError("NOT_FOUND");
    }
    return {
      body: { appName: session.app.name, expiresAt: session.expiresAt, sessionId: session.id },
    };
  });

export const accept = protectedRouter
  .meta(openapi({ path: "/shares/{shareId}/accept", method: "POST" }))
  .input(
    z.object({
      params: z.object({ shareId: opaqueId }),
      body: z.object({ scope: scopeSchema }),
    }),
  )
  .output(z.object({ body: z.object({ grantId: opaqueId, sessionId: z.uuid() }) }))
  .handler(async ({ context, input }) => {
    const kv = requirePreviewKV();
    const scope = canonicalizeScope(input.body.scope);
    const session = await db.query.previewSession.findFirst({
      where: { shareId: input.params.shareId, projectId: context.project.id, status: "active" },
    });
    if (
      !session ||
      session.expiresAt <= new Date() ||
      !(await ensurePreviewDeveloperGrace(kv, session.id))
    ) {
      throw new ORPCError("NOT_FOUND");
    }
    const grantId = createId();
    const ttl = Math.max(
      1,
      Math.min(24 * 60 * 60, Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000)),
    );
    await kv.set(
      grantKey(grantId),
      JSON.stringify({
        projectId: context.project.id,
        sessionId: session.id,
        scope: scope.scope,
      } satisfies Grant),
      { ttl },
    );
    return { body: { grantId, sessionId: session.id } };
  });

const previewMetadata = z.object({
  sessionId: z.uuid(),
  expiresAt: z.date(),
  websocketUrl: z.url(),
  token: z.string(),
});

export const accepted = protectedRouter
  .meta(openapi({ path: "/grants/resolve", method: "POST" }))
  .input(
    z.object({
      body: z.object({ grantIds: z.array(opaqueId).max(20), scopes: scopesSchema }),
    }),
  )
  .output(
    z.object({
      body: z.object({
        items: z.array(
          z.object({
            app: AppWithCurrentDeployment,
            preview: previewMetadata,
          }),
        ),
      }),
    }),
  )
  .handler(async ({ context, input }) => {
    const kv = requirePreviewKV();
    const scopes = canonicalizeScopes(input.body.scopes);
    const items = [];
    const seen = new Set<string>();
    for (const grantId of input.body.grantIds) {
      const raw = await kv.get(grantKey(grantId));
      if (!raw) {
        continue;
      }
      let grant: Grant;
      try {
        grant = grantSchema.parse(JSON.parse(raw) as unknown);
      } catch {
        continue;
      }
      if (
        grant.projectId !== context.project.id ||
        !scopes.some(({ scope }) => scopeMatches(grant.scope, scope))
      ) {
        continue;
      }
      const session = await db.query.previewSession.findFirst({
        where: { id: grant.sessionId, projectId: context.project.id, status: "active" },
        with: { app: { with: { currentDeployment: { where: { status: "published" } } } } },
      });
      if (
        !session?.app ||
        session.expiresAt <= new Date() ||
        seen.has(session.app.id) ||
        !(await ensurePreviewDeveloperGrace(kv, session.id))
      ) {
        continue;
      }
      seen.add(session.app.id);
      items.push({
        app: withAppAssetUrl(session.app, context.organization.publicId, context.project.id),
        preview: {
          sessionId: session.id,
          expiresAt: session.expiresAt,
          websocketUrl: previewWebSocketUrl(session.id, "viewer"),
          token: createPreviewViewerToken(session.id),
        },
      });
    }
    return { body: { items } };
  });

export const previewGrantRoutes = { invitation, accept, accepted };
