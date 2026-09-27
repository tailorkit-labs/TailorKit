import { ORPCError } from "@orpc/server";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { getBaseUrl } from "@tailorkit/env";
import { env } from "#env";
import { getKV } from "@tailorkit/kv";
import { db } from "@tailorkit/db";
import { previewSession } from "@tailorkit/db/schema/preview-session";
import { project } from "@tailorkit/db/schema/project";
import { and, count, eq, lt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import z from "zod";
import { createPreviewBuildStore } from "../preview-build-store";
import { ensurePreviewDeveloperGrace } from "../preview-lifecycle";
import { o, protectedRouter } from "../procedures";
import { previewGrantRoutes } from "./preview-grants";

const previewSessionLifetimeMs = 8 * 60 * 60 * 1000;
const firstConnectionGraceMs = 2 * 60 * 1000;
const maxActivePreviewsPerScope = 5;
const activePreviewConflictReason = "ACTIVE_PREVIEW_EXISTS";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function hash(value: string): string {
  if (!env.AUTH_SECRET) {
    throw new Error("AUTH_SECRET is required for preview credentials.");
  }
  return hashSecret(value, env.AUTH_SECRET);
}

function createSecret(): string {
  return randomBytes(32).toString("base64url");
}

async function getValidCliToken(projectId: string, deployToken: string) {
  const token = await db.query.cliToken.findFirst({
    where: {
      projectId,
      tokenHash: hash(deployToken),
    },
  });
  if (!token || token.revokedAt || token.expiresAt <= new Date()) {
    throw new ORPCError("UNAUTHORIZED", { message: "Invalid CLI deploy token." });
  }
  return token;
}

const startPreview = protectedRouter
  .route({ path: "/start", method: "POST" })
  .input(
    z.object({
      body: z.object({
        appId: z.string().min(1),
        deployToken: z.string().min(1),
        replaceActive: z.boolean().optional(),
      }),
    }),
  )
  .output(
    z.object({
      body: z.object({
        expiresAt: z.date(),
        sessionId: z.string(),
        tunnelToken: z.string(),
        tunnelUrl: z.url(),
        shareId: z.string(),
      }),
    }),
  )
  .handler(async ({ context, input }) => {
    const kv = getKV();
    if (!kv) {
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "Preview storage is unavailable: configure KV.",
      });
    }
    const now = new Date();
    const token = await getValidCliToken(context.project.id, input.body.deployToken);

    const previewApp = await db.query.app.findFirst({
      where: {
        projectId: context.project.id,
        scopeId: token.scopeId,
        ...(uuidPattern.test(input.body.appId)
          ? { id: input.body.appId }
          : { publicId: input.body.appId }),
      },
    });
    if (!previewApp) {
      throw new ORPCError("NOT_FOUND", { message: "App not found for this host scope." });
    }

    const activeSessions = await db.query.previewSession.findMany({
      where: {
        projectId: context.project.id,
        scopeId: token.scopeId,
        status: "active",
      },
    });
    for (const activeSession of activeSessions) {
      if (activeSession.expiresAt > now) {
        await ensurePreviewDeveloperGrace(
          kv,
          activeSession.id,
          activeSession.createdAt.getTime() + firstConnectionGraceMs <= now.getTime(),
        );
      }
    }

    const tunnelToken = createSecret();
    const shareId = createSecret();
    const expiresAt = new Date(now.getTime() + previewSessionLifetimeMs);
    const started = await db
      .transaction(async (tx) => {
        // Serialize starts in this project so concurrent app starts cannot exceed the scope cap.
        await tx
          .select({ id: project.id })
          .from(project)
          .where(eq(project.id, context.project.id))
          .for("update");
        const expiredSessions = await tx
          .update(previewSession)
          .set({ endedAt: now, status: "ended" })
          .where(
            and(
              eq(previewSession.projectId, context.project.id),
              eq(previewSession.scopeId, token.scopeId),
              eq(previewSession.status, "active"),
              lt(previewSession.expiresAt, now),
            ),
          )
          .returning({ id: previewSession.id });
        const active = await tx.query.previewSession.findFirst({
          where: {
            appId: previewApp.id,
            status: "active",
          },
        });
        if (active && !input.body.replaceActive) {
          throw new ORPCError("CONFLICT", {
            data: { reason: activePreviewConflictReason },
            message: "A preview is already running for this app.",
          });
        }
        const replacedSessions = active
          ? await tx
              .update(previewSession)
              .set({ endedAt: now, status: "ended" })
              .where(and(eq(previewSession.id, active.id), eq(previewSession.status, "active")))
              .returning({ id: previewSession.id })
          : [];
        const [scopeCount] = await tx
          .select({ total: count() })
          .from(previewSession)
          .where(
            and(
              eq(previewSession.projectId, context.project.id),
              eq(previewSession.scopeId, token.scopeId),
              eq(previewSession.status, "active"),
            ),
          );
        if ((scopeCount?.total ?? 0) >= maxActivePreviewsPerScope) {
          throw new ORPCError("CONFLICT", {
            message: `This scope already has ${maxActivePreviewsPerScope} active previews.`,
          });
        }
        const [created] = await tx
          .insert(previewSession)
          .values({
            appId: previewApp.id,
            cliTokenId: token.id,
            expiresAt,
            projectId: context.project.id,
            scopeId: token.scopeId,
            shareId,
            tunnelTokenHash: hash(tunnelToken),
          })
          .returning({ id: previewSession.id });
        return { session: created, expiredSessions, replacedSessions };
      })
      .catch((error: unknown) => {
        if (error instanceof ORPCError) {
          throw error;
        }
        const candidate =
          error && typeof error === "object" && "cause" in error ? error.cause : error;
        if (
          candidate &&
          typeof candidate === "object" &&
          "code" in candidate &&
          candidate.code === "23505"
        ) {
          throw new ORPCError("CONFLICT", {
            data: { reason: activePreviewConflictReason },
            message: "A preview is already running for this app.",
          });
        }
        throw error;
      });
    if (!started.session) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create preview." });
    }
    const builds = createPreviewBuildStore(kv);
    for (const ended of [...started.expiredSessions, ...started.replacedSessions]) {
      try {
        await builds.end(ended.id);
      } catch {
        // Existing KV TTLs bound cleanup if the store is temporarily unavailable.
      }
    }

    const baseUrl = getBaseUrl(env).replace(/^http/u, "ws");
    const tunnelUrl = new URL("/api/platform/preview/ws", baseUrl);
    tunnelUrl.searchParams.set("session", started.session.id);
    return {
      body: {
        expiresAt,
        sessionId: started.session.id,
        shareId,
        tunnelToken,
        tunnelUrl: tunnelUrl.href,
      },
    };
  });

const stopPreview = protectedRouter
  .route({ path: "/:sessionId/stop", method: "POST" })
  .input(
    z.object({
      body: z.object({ deployToken: z.string().min(1) }),
      params: z.object({ sessionId: z.uuid() }),
    }),
  )
  .output(z.object({ body: z.object({}) }))
  .handler(async ({ context, input }) => {
    const token = await getValidCliToken(context.project.id, input.body.deployToken);

    const [endedSession] = await db
      .update(previewSession)
      .set({ endedAt: new Date(), status: "ended" })
      .where(
        and(
          eq(previewSession.id, input.params.sessionId),
          eq(previewSession.projectId, context.project.id),
          eq(previewSession.cliTokenId, token.id),
          eq(previewSession.status, "active"),
        ),
      )
      .returning({ id: previewSession.id });
    const alreadyEnded = endedSession
      ? null
      : await db.query.previewSession.findFirst({
          where: {
            id: input.params.sessionId,
            projectId: context.project.id,
            cliTokenId: token.id,
            status: "ended",
          },
        });
    const sessionId = endedSession?.id ?? alreadyEnded?.id;
    if (!sessionId) {
      throw new ORPCError("NOT_FOUND", { message: "Preview session is unavailable." });
    }
    const kv = getKV();
    if (kv) {
      await createPreviewBuildStore(kv).end(sessionId);
    }
    return { body: {} };
  });

export const previewRouter = o
  .prefix("/preview")
  .router({ start: startPreview, stop: stopPreview, ...previewGrantRoutes });
