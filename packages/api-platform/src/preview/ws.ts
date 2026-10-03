import { asyncIteratorObject, ORPCError, os } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { db } from "@tailorkit/db";
import { sanitizeErrorForLog } from "@tailorkit/observability";
import z from "zod";
import { requirePreviewKV } from "./runtime";
import { createPreviewBuildStore } from "./build-store";
import {
  previewChunkBytes,
  previewMessageBytes,
  previewBuildFiles,
  previewFileBytes,
} from "./constants";
import { previewIdentifierSchema as id, previewManifestSchema as manifest } from "./manifest";
import {
  endPreviewSession,
  ensurePreviewDeveloperGrace,
  recordPreviewHeartbeat,
} from "./lifecycle";

const event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("begin"), revision: z.number().int(), buildId: id, manifest }),
  z.object({
    type: z.literal("chunk"),
    revision: z.number().int(),
    fileIndex: z.number().int(),
    chunkIndex: z.number().int(),
    base64: z.string().max(4 * Math.ceil(previewChunkBytes / 3)),
  }),
  z.object({ type: z.literal("complete"), revision: z.number().int() }),
  z.object({ type: z.literal("ended") }),
]);

async function logPreviewOperationFailure<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error("Preview WebSocket operation failed", {
      operation,
      error: sanitizeErrorForLog(error),
    });
    throw error;
  }
}

export type PreviewWebSocketContext =
  | {
      sessionId: string;
      role: "uploader";
    }
  | {
      sessionId: string;
      role: "viewer";
      viewerTokenExpiresAt: number;
    };

function requireFreshViewerToken(context: PreviewWebSocketContext): void {
  if (context.role !== "viewer" || context.viewerTokenExpiresAt <= Date.now()) {
    throw new ORPCError("UNAUTHORIZED", { message: "Preview viewer token expired." });
  }
}

const o = os.$context<PreviewWebSocketContext>();
const requireRole = async (
  context: PreviewWebSocketContext,
  role: PreviewWebSocketContext["role"],
) => {
  if (context.role !== role) {
    throw new ORPCError("FORBIDDEN");
  }
  const session = await db.query.previewSession.findFirst({
    where: { id: context.sessionId, status: "active" },
    with: { cliToken: true },
  });
  if (!session || session.expiresAt <= new Date()) {
    throw new ORPCError("UNAUTHORIZED", { message: "Preview session is unavailable." });
  }
  const kv = requirePreviewKV();
  if (
    role === "uploader" &&
    (!session.cliToken || session.cliToken.revokedAt || session.cliToken.expiresAt <= new Date())
  ) {
    await endPreviewSession(kv, context.sessionId);
    throw new ORPCError("UNAUTHORIZED", { message: "Preview CLI token is unavailable." });
  }
  if (!(await ensurePreviewDeveloperGrace(kv, context.sessionId))) {
    throw new ORPCError("UNAUTHORIZED", { message: "Preview developer reconnect grace expired." });
  }
  return createPreviewBuildStore(kv);
};

const beginBuild = o
  .input(z.object({ manifest }))
  .output(z.object({ buildId: id }))
  .handler(({ context, input }) =>
    logPreviewOperationFailure("begin", async () => {
      const store = await requireRole(context, "uploader");
      return { buildId: await store.begin(context.sessionId, input.manifest) };
    }),
  );
const uploadChunk = o
  .input(
    z.object({
      buildId: id,
      fileIndex: z
        .number()
        .int()
        .min(0)
        .max(previewBuildFiles - 1),
      chunkIndex: z
        .number()
        .int()
        .min(0)
        .max(Math.ceil(previewFileBytes / previewChunkBytes) - 1),
      base64: z.string().max(4 * Math.ceil(previewChunkBytes / 3)),
    }),
  )
  .output(z.object({ accepted: z.literal(true) }))
  .handler(({ context, input }) =>
    logPreviewOperationFailure("upload_chunk", async () => {
      if (Buffer.byteLength(JSON.stringify(input)) > previewMessageBytes) {
        throw new ORPCError("PAYLOAD_TOO_LARGE");
      }
      const store = await requireRole(context, "uploader");
      await store.upload(
        context.sessionId,
        input.buildId,
        input.fileIndex,
        input.chunkIndex,
        input.base64,
      );
      return { accepted: true as const };
    }),
  );
const commitBuild = o
  .input(z.object({ buildId: id }))
  .output(z.object({ revision: z.number().int() }))
  .handler(({ context, input }) =>
    logPreviewOperationFailure("commit", async () => {
      const store = await requireRole(context, "uploader");
      const result = await store.commit(context.sessionId, input.buildId);
      return { revision: result.revision };
    }),
  );
const heartbeat = o.output(z.object({ accepted: z.literal(true) })).handler(async ({ context }) => {
  await requireRole(context, "uploader");
  const kv = requirePreviewKV();
  if (!(await recordPreviewHeartbeat(kv, context.sessionId))) {
    throw new ORPCError("UNAUTHORIZED", { message: "Preview session is unavailable." });
  }
  return { accepted: true as const };
});

const subscribe = o.output(asyncIteratorObject(event)).handler(async function* subscribe({
  context,
}) {
  requireFreshViewerToken(context);
  const store = await requireRole(context, "viewer");
  let wake: (() => void) | undefined;
  const waitForSignal = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });
  let signalled = true;
  const notify = () => {
    signalled = true;
    wake?.();
  };
  const unsubscribe = await store.subscribe(context.sessionId, notify);
  const timer = setInterval(notify, 10_000);
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const notifyWhenExpired = () => {
    if (context.role !== "viewer") {
      return;
    }
    const remaining = context.viewerTokenExpiresAt - Date.now();
    if (remaining > 0) {
      expiryTimer = setTimeout(notifyWhenExpired, remaining);
    } else {
      notify();
    }
  };
  notifyWhenExpired();
  let lastRevision = 0;
  try {
    for (;;) {
      if (!signalled) {
        await waitForSignal();
      }
      wake = undefined;
      signalled = false;
      requireFreshViewerToken(context);
      try {
        await requireRole(context, "viewer");
      } catch {
        yield { type: "ended" as const };
        break;
      }
      const build = await store.current(context.sessionId);
      if (!build || build.revision <= lastRevision) {
        continue;
      }
      const { buildId, manifest, revision } = build;
      requireFreshViewerToken(context);
      yield { type: "begin" as const, buildId, manifest, revision };
      let complete = true;
      for (const [fileIndex, file] of manifest.files.entries()) {
        for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
          const base64 = await store.chunk(context.sessionId, buildId, fileIndex, chunkIndex);
          if (base64 === null) {
            complete = false;
            break;
          }
          requireFreshViewerToken(context);
          yield { type: "chunk" as const, revision, fileIndex, chunkIndex, base64 };
        }
        if (!complete) {
          break;
        }
      }
      if (complete) {
        requireFreshViewerToken(context);
        yield { type: "complete" as const, revision };
        lastRevision = revision;
      }
    }
  } finally {
    clearInterval(timer);
    clearTimeout(expiryTimer);
    await unsubscribe();
  }
});

export const previewWebSocketRouter = {
  beginBuild,
  uploadChunk,
  commitBuild,
  heartbeat,
  subscribe,
};
export type PreviewWebSocketRouterClient = RouterClient<typeof previewWebSocketRouter>;
