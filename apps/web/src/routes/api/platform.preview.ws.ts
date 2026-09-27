import { experimental_RPCHandler as RPCHandler } from "@orpc/server/crossws";
import { authorizePreviewSocket } from "@tailorkit/api-platform/preview-ws-auth";
import { previewWebSocketRouter } from "@tailorkit/api-platform/preview-ws";
import type { PreviewWebSocketContext } from "@tailorkit/api-platform/preview-ws";
import { createFileRoute } from "@tanstack/react-router";
import { defineHooks } from "crossws";
import { z } from "zod";

const handler = new RPCHandler(previewWebSocketRouter);
interface AuthorizationState {
  promise: Promise<PreviewWebSocketContext | null>;
  context: PreviewWebSocketContext | null | undefined;
  pendingMessage: boolean;
}
const authorizations = new WeakMap<object, AuthorizationState>();
const upgradeSchema = z.object({
  sessionId: z.uuid(),
  role: z.enum(["uploader", "viewer"]),
  token: z.string().min(1),
});

const hooks = defineHooks({
  upgrade(request) {
    const url = new URL(request.url);
    const token = request.headers.get("sec-websocket-protocol")?.split(",")[0]?.trim();
    return {
      context: {
        sessionId: url.searchParams.get("session"),
        role: url.searchParams.get("role"),
        token,
      },
      protocol: token,
    };
  },
  async open(peer) {
    const parsed = upgradeSchema.safeParse(peer.context);
    if (!parsed.success) {
      return peer.close();
    }
    const { sessionId, role, token } = parsed.data;
    const state: AuthorizationState = {
      promise: authorizePreviewSocket(sessionId, token, role).catch(() => null),
      context: undefined,
      pendingMessage: false,
    };
    authorizations.set(peer, state);
    const context = await state.promise;
    if (authorizations.get(peer) !== state) {
      return;
    }
    state.context = context;
    if (!context) {
      return peer.close();
    }
  },
  async message(peer, message) {
    const state = authorizations.get(peer);
    if (!state) {
      return peer.close();
    }
    const payload = message.rawData;
    let size = Infinity;
    if (typeof payload === "string") {
      size = Buffer.byteLength(payload);
    } else if (payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
      size = payload.byteLength;
    }
    if (size > 512 * 1024) {
      authorizations.delete(peer);
      return peer.close();
    }
    if (state.context === undefined) {
      if (state.pendingMessage) {
        authorizations.delete(peer);
        return peer.close();
      }
      state.pendingMessage = true;
      try {
        await state.promise;
      } finally {
        state.pendingMessage = false;
      }
    }
    if (authorizations.get(peer) !== state) {
      return;
    }
    const context = state.context;
    if (!context) {
      return peer.close();
    }
    return handler.message(peer, message, { context });
  },
  close(peer) {
    handler.close(peer);
    authorizations.delete(peer);
  },
});

export const Route = createFileRoute("/api/platform/preview/ws")({
  server: {
    handlers: {
      GET: () =>
        Object.assign(new Response("WebSocket upgrade is required.", { status: 426 }), {
          crossws: hooks,
        }),
    },
  },
});
