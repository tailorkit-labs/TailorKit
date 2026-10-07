import { atom, batch } from "nanostores";
import type { WritableAtom } from "nanostores";
import { createPreviewWebSocketClient } from "@tailorkit/client-platform/preview";
import type { PreviewBuildManifest, PreviewEvent } from "@tailorkit/client-platform/preview";
import type { TailorKitApp } from "../../types";
import { createEndpointClient } from "../../client/endpoints";

export interface PreviewSnapshot {
  revision: number;
  source: string | null;
}
const empty: PreviewSnapshot = { revision: 0, source: null };

interface Candidate {
  revision: number;
  manifest: PreviewBuildManifest;
  files: (Uint8Array | null)[][];
}

interface Entry {
  app: TailorKitApp;
  metadata: NonNullable<TailorKitApp["preview"]> | null;
  candidate: Candidate | null;
  subscribers: number;
  state: WritableAtom<PreviewSnapshot>;
  socket: WebSocket | null;
  connecting: boolean;
  reconnect: ReturnType<typeof setTimeout> | null;
  delay: number;
}

function viewerTokenExpiresAt(metadata: NonNullable<TailorKitApp["preview"]>): number {
  const expiresAt = Number(metadata.token.split(".", 1)[0]);
  return Number.isSafeInteger(expiresAt) ? expiresAt : 0;
}

function bytesFromBase64(value: string): Uint8Array {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) {
    bytes[index] = raw.codePointAt(index) ?? 0;
  }
  return bytes;
}

async function verify(candidate: Candidate): Promise<string | null> {
  let source: string | null = null;
  for (const [fileIndex, file] of candidate.manifest.files.entries()) {
    const parts = candidate.files[fileIndex];
    if (!parts || parts.length !== file.chunks || parts.some((part) => part === null)) {
      return null;
    }
    const bytes = new Uint8Array(file.size);
    let offset = 0;
    for (const part of parts) {
      if (!part) {
        return null;
      }
      bytes.set(part, offset);
      offset += part.length;
    }
    if (offset !== file.size) {
      return null;
    }
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== file.sha256) {
      return null;
    }
    if (file.path === "client.js") {
      source = new TextDecoder().decode(bytes);
    }
  }
  return source;
}

export function createPreviewManager(
  baseUrl: URL,
  onEnded: () => void,
  onViews?: (appId: string, views: NonNullable<TailorKitApp["views"]>) => void,
  refreshMetadata = createEndpointClient({ baseUrl }).previewMetadata,
) {
  const entries = new Map<string, Entry>();
  const close = (entry: Entry) => {
    if (entry.reconnect) {
      clearTimeout(entry.reconnect);
    }
    entry.reconnect = null;
    const socket = entry.socket;
    entry.socket = null;
    socket?.close();
    entry.connecting = false;
    entry.candidate = null;
  };
  const end = (entry: Entry) => {
    close(entry);
    entry.metadata = null;
    entry.state.set(empty);
    onEnded();
  };
  const handleEvent = async (entry: Entry, event: PreviewEvent) => {
    if (event.type === "ended") {
      end(entry);
      return;
    }
    if (event.revision <= entry.state.get().revision) {
      return;
    }
    if (event.type === "begin") {
      entry.candidate = {
        revision: event.revision,
        manifest: event.manifest,
        files: event.manifest.files.map((file) => Array.from({ length: file.chunks }, () => null)),
      };
      return;
    }
    const candidate = entry.candidate;
    if (!candidate || candidate.revision !== event.revision) {
      return;
    }
    if (event.type === "chunk") {
      const file = candidate.manifest.files[event.fileIndex];
      const slots = candidate.files[event.fileIndex];
      if (
        !file ||
        !slots ||
        event.chunkIndex < 0 ||
        event.chunkIndex >= slots.length ||
        slots[event.chunkIndex]
      ) {
        entry.candidate = null;
        return;
      }
      const bytes = bytesFromBase64(event.base64);
      if (bytes.length !== Math.min(256 * 1024, file.size - event.chunkIndex * 256 * 1024)) {
        entry.candidate = null;
        return;
      }
      slots[event.chunkIndex] = bytes;
      return;
    }
    if (event.type === "complete") {
      const source = await verify(candidate);
      if (
        source !== null &&
        entry.candidate === candidate &&
        candidate.revision > entry.state.get().revision
      ) {
        batch(() => {
          entry.state.set({ revision: candidate.revision, source });
          if (candidate.manifest.views !== undefined)
            onViews?.(entry.app.id, candidate.manifest.views);
        });
      }
      if (entry.candidate === candidate) {
        entry.candidate = null;
      }
    }
  };
  const connect = async (entry: Entry) => {
    if (!entry.subscribers || !entry.app.preview || entry.socket || entry.connecting) {
      return;
    }
    entry.connecting = true;
    const appMetadata = entry.app.preview;
    let metadata =
      entry.metadata &&
      viewerTokenExpiresAt(entry.metadata) > Math.max(Date.now(), viewerTokenExpiresAt(appMetadata))
        ? entry.metadata
        : appMetadata;
    try {
      const refreshed = await refreshMetadata(metadata.sessionId);
      if (refreshed) {
        metadata = refreshed;
        entry.metadata = metadata;
      } else {
        end(entry);
        return;
      }
    } catch {
      /* The existing short-lived token may still be valid. */
    }
    if (!entry.subscribers) {
      entry.connecting = false;
      return;
    }
    const socket = new WebSocket(metadata.websocketUrl, metadata.token);
    entry.socket = socket;
    entry.connecting = false;
    socket.addEventListener("open", () => {
      entry.delay = 1000;
      const client = createPreviewWebSocketClient(socket);
      void (async () => {
        try {
          const stream = await client.subscribe();
          for await (const event of stream) {
            await handleEvent(entry, event);
          }
        } catch {
          /* A token expiry ends this stream and requires fresh metadata. */
        } finally {
          socket.close();
        }
      })();
    });
    socket.addEventListener("error", () => socket.close());
    socket.addEventListener("close", () => {
      if (entry.socket !== socket) {
        return;
      }
      entry.socket = null;
      entry.candidate = null;
      if (entry.subscribers) {
        entry.reconnect = setTimeout(() => {
          entry.reconnect = null;
          void connect(entry);
        }, entry.delay);
        entry.delay = Math.min(entry.delay * 2, 30_000);
      }
    });
  };
  return {
    getSnapshot: (sessionId: string): PreviewSnapshot =>
      entries.get(sessionId)?.state.get() ?? empty,
    updateApp: (app: TailorKitApp): void => {
      const sessionId = app.preview?.sessionId;
      const entry = sessionId && entries.get(sessionId);
      if (entry) {
        entry.app = app;
      }
    },
    subscribe: (app: TailorKitApp, listener: () => void): (() => void) => {
      const sessionId = app.preview?.sessionId;
      if (!sessionId) {
        return () => {};
      }
      let entry = entries.get(sessionId);
      if (!entry) {
        entry = {
          app,
          metadata: null,
          candidate: null,
          subscribers: 0,
          state: atom(empty),
          socket: null,
          connecting: false,
          reconnect: null,
          delay: 1000,
        };
        entries.set(sessionId, entry);
      }
      entry.app = app;
      entry.subscribers += 1;
      const current = entry;
      const unsubscribe = current.state.listen(listener);
      void connect(entry);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        unsubscribe();
        current.subscribers = Math.max(0, current.subscribers - 1);
        if (!current.subscribers) {
          close(current);
          if (entries.get(sessionId) === current) entries.delete(sessionId);
        }
      };
    },
    dispose: () => {
      for (const entry of entries.values()) {
        entry.subscribers = 0;
        close(entry);
      }
      entries.clear();
    },
  };
}
