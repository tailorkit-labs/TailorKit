import {
  createPreviewWebSocketClient,
  previewMetadataSchema,
} from "@tailorkit/client-platform/preview";
import type { PreviewBuildManifest, PreviewEvent } from "@tailorkit/client-platform/preview";
import type { TailorKitApp } from "./tailor-kit";

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
  listeners: Set<() => void>;
  snapshot: PreviewSnapshot;
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

export function createPreviewManager(baseUrl: URL, onEnded: () => void) {
  const entries = new Map<string, Entry>();
  const notify = (entry: Entry) => {
    for (const listener of entry.listeners) {
      listener();
    }
  };
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
    entry.snapshot = empty;
    notify(entry);
    onEnded();
  };
  const handleEvent = async (entry: Entry, event: PreviewEvent) => {
    if (event.type === "ended") {
      end(entry);
      return;
    }
    if (event.revision <= entry.snapshot.revision) {
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
        candidate.revision > entry.snapshot.revision
      ) {
        entry.snapshot = { revision: candidate.revision, source };
        notify(entry);
      }
      if (entry.candidate === candidate) {
        entry.candidate = null;
      }
    }
  };
  const connect = async (entry: Entry) => {
    if (!entry.listeners.size || !entry.app.preview || entry.socket || entry.connecting) {
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
      const refresh = new URL("preview/metadata", baseUrl);
      refresh.searchParams.set("sessionId", metadata.sessionId);
      const response = await fetch(refresh, { credentials: "same-origin" });
      if (response.ok) {
        metadata = previewMetadataSchema.parse(await response.json());
        entry.metadata = metadata;
      } else if (response.status === 404) {
        end(entry);
        return;
      }
    } catch {
      /* The existing short-lived token may still be valid. */
    }
    if (!entry.listeners.size) {
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
      if (entry.listeners.size) {
        entry.reconnect = setTimeout(() => {
          entry.reconnect = null;
          void connect(entry);
        }, entry.delay);
        entry.delay = Math.min(entry.delay * 2, 30_000);
      }
    });
  };
  return {
    getSnapshot: (sessionId: string): PreviewSnapshot => entries.get(sessionId)?.snapshot ?? empty,
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
          listeners: new Set(),
          snapshot: empty,
          socket: null,
          connecting: false,
          reconnect: null,
          delay: 1000,
        };
        entries.set(sessionId, entry);
      }
      entry.app = app;
      entry.listeners.add(listener);
      void connect(entry);
      return () => {
        entry?.listeners.delete(listener);
        if (entry && !entry.listeners.size) {
          close(entry);
          entries.delete(sessionId);
        }
      };
    },
    dispose: () => {
      for (const entry of entries.values()) {
        close(entry);
      }
      entries.clear();
    },
  };
}
