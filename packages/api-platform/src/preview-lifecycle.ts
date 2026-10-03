import { db } from "@tailorkit/db";
import { previewSession } from "@tailorkit/db/schema/preview-session";
import type { KV } from "@tailorkit/kv";
import { createPreviewPresence } from "@tailorkit/kv";
import { and, eq } from "drizzle-orm";
import { createPreviewBuildStore } from "./preview-build-store";

const everKey = (sessionId: string) => `preview:developer-seen:${sessionId}`;
const presenceKey = (sessionId: string) => `preview:developer-connection:${sessionId}`;
const endedKey = (sessionId: string) => `preview:ended:${sessionId}`;
const activeTtlSeconds = 8 * 60 * 60;

export function recordPreviewHeartbeat(kv: KV, sessionId: string): Promise<boolean> {
  return createPreviewPresence(kv).heartbeatIfActive(
    sessionId,
    {
      connectionId: sessionId,
      revision: 0,
    },
    everKey(sessionId),
    endedKey(sessionId),
    activeTtlSeconds,
  );
}

export async function endPreviewSession(kv: KV, sessionId: string): Promise<void> {
  await db
    .update(previewSession)
    .set({ status: "ended", endedAt: new Date() })
    .where(and(eq(previewSession.id, sessionId), eq(previewSession.status, "active")));
  await createPreviewBuildStore(kv).end(sessionId);
}

/** A developer has 75 seconds from the last heartbeat to reconnect. */
export async function ensurePreviewDeveloperGrace(
  kv: KV,
  sessionId: string,
  expireUnseen = false,
): Promise<boolean> {
  if (
    await kv.keepPreviewSessionIfDeveloperPresent(
      presenceKey(sessionId),
      everKey(sessionId),
      endedKey(sessionId),
      activeTtlSeconds,
      expireUnseen,
    )
  ) {
    return true;
  }
  await endPreviewSession(kv, sessionId);
  return false;
}
