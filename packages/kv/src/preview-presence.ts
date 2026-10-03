import type { KV, Unsubscribe } from "./types.js";
import { z } from "zod";

export const previewHeartbeatSeconds = 20;
export const previewLeaseSeconds = 75;
const keyPrefix = "preview:developer-connection:";
const channelPrefix = "preview:developer-events:";

export interface PreviewConnection {
  connectionId: string;
  revision: number;
}

function connectionKey(sessionId: string): string {
  return `${keyPrefix}${sessionId}`;
}

function connectionChannel(sessionId: string): string {
  return `${channelPrefix}${sessionId}`;
}

const identifierSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,128}$/u, "Preview identifiers must be opaque identifiers.");
const connectionSchema = z.object({
  connectionId: identifierSchema,
  revision: z.number().int().nonnegative(),
});
function assertSessionId(sessionId: string): void {
  if (!identifierSchema.safeParse(sessionId).success) {
    throw new TypeError("Preview session id must be an opaque identifier.");
  }
}
function assertConnection(connection: PreviewConnection): void {
  connectionSchema.parse(connection);
}

function parseConnection(raw: string): PreviewConnection | null {
  try {
    return connectionSchema.parse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Stores a renewable CLI presence lease. Socket closes are not session ends. */
export function createPreviewPresence(kv: KV) {
  return {
    async heartbeatIfActive(
      sessionId: string,
      connection: PreviewConnection,
      seenKey: string,
      endedKey: string,
      seenTtl: number,
    ): Promise<boolean> {
      assertSessionId(sessionId);
      assertConnection(connection);
      const value = JSON.stringify(connection);
      const active = await kv.setPreviewPresenceIfActive(
        connectionKey(sessionId),
        seenKey,
        endedKey,
        value,
        previewLeaseSeconds,
        seenTtl,
      );
      if (active) {
        try {
          await kv.publish(connectionChannel(sessionId), value);
        } catch {
          // The lease is authoritative; pub/sub only reduces update latency.
        }
      }
      return active;
    },
    async heartbeat(sessionId: string, connection: PreviewConnection): Promise<void> {
      assertSessionId(sessionId);
      assertConnection(connection);
      await kv.set(connectionKey(sessionId), JSON.stringify(connection), {
        ttl: previewLeaseSeconds,
      });
      // Pub/sub wakes already-connected tunnel handlers immediately. The lease
      // above remains the source of truth when a subscriber reconnects late or
      // misses a transient Redis message.
      try {
        await kv.publish(connectionChannel(sessionId), JSON.stringify(connection));
      } catch {
        // The lease is authoritative; pub/sub only reduces update latency.
      }
    },
    async get(sessionId: string): Promise<PreviewConnection | null> {
      assertSessionId(sessionId);
      const raw = await kv.get(connectionKey(sessionId));
      if (!raw) {
        return null;
      }
      return parseConnection(raw);
    },
    /**
     * Subscribes to connection changes for an active tunnel handler. This is
     * best effort; callers must call `get` after subscribing to close the race
     * between loading the lease and opening their Redis subscription.
     */
    subscribe(
      sessionId: string,
      handler: (connection: PreviewConnection) => void,
    ): Promise<Unsubscribe> {
      assertSessionId(sessionId);
      return kv.subscribe(connectionChannel(sessionId), (message) => {
        const connection = parseConnection(message);
        if (connection) {
          handler(connection);
        }
      });
    },
  };
}
