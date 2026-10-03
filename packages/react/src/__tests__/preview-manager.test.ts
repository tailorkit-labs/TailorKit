/* oxlint-disable require-await -- transport mocks return the asynchronous client shape. */
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createPreviewManager } from "../preview-manager";
import type { PreviewEvent } from "@tailorkit/client-platform/preview";

const state = vi.hoisted(() => ({
  events: [] as PreviewEvent[],
  batches: [] as PreviewEvent[][],
  hold: false,
  release: undefined as (() => void) | undefined,
}));
vi.mock("@tailorkit/client-platform/preview", async (original) => ({
  ...(await original()),
  createPreviewWebSocketClient: () => ({
    subscribe: async () =>
      (async function* subscribe() {
        yield* state.batches.shift() ?? state.events;
        if (state.hold) {
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        }
      })(),
  }),
}));

class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  closed = false;
  readonly protocol: string;
  constructor(_url: string, protocol: string) {
    super();
    this.protocol = protocol;
    FakeSocket.instances.push(this);
  }
  close() {
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
  open() {
    this.dispatchEvent(new Event("open"));
  }
}

it("refreshes the viewer token and reconnects when its stream ends", async () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  vi.stubGlobal("WebSocket", FakeSocket);
  let refreshes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sessionId,
        websocketUrl: "wss://platform.test/preview",
        token: `token-${++refreshes}`,
        expiresAt: "2030-01-01T00:00:00.000Z",
      }),
    })),
  );
  const onEnded = vi.fn();
  const manager = createPreviewManager(new URL("https://host.test/api/tailorkit/"), onEnded);
  const unsubscribe = manager.subscribe(
    {
      id: "app",
      preview: {
        sessionId,
        expiresAt: "later",
        websocketUrl: "wss://platform.test/preview",
        token: "initial-token",
      },
    },
    vi.fn(),
  );
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  expect(FakeSocket.instances[0]?.protocol).toBe("token-1");
  FakeSocket.instances[0]?.open();
  await vi.waitFor(() => expect(FakeSocket.instances[0]?.closed).toBe(true));
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 2500 });
  expect(FakeSocket.instances[1]?.protocol).toBe("token-2");
  expect(onEnded).not.toHaveBeenCalled();
  unsubscribe();
});

it("reuses a still-valid refreshed token when the next metadata request fails", async () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const refreshedToken = `${Date.now() + 60_000}.refreshed`;
  vi.stubGlobal("WebSocket", FakeSocket);
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (++requests > 1) {
        throw new Error("Metadata temporarily unavailable.");
      }
      return {
        ok: true,
        json: async () => ({
          sessionId,
          websocketUrl: "wss://platform.test/preview",
          token: refreshedToken,
          expiresAt: "2030-01-01T00:00:00.000Z",
        }),
      };
    }),
  );
  const manager = createPreviewManager(new URL("https://host.test/api/tailorkit/"), vi.fn());
  const unsubscribe = manager.subscribe(
    {
      id: "app",
      preview: {
        sessionId,
        expiresAt: "later",
        websocketUrl: "wss://platform.test/preview",
        token: "expired-original",
      },
    },
    vi.fn(),
  );
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  expect(FakeSocket.instances[0]?.protocol).toBe(refreshedToken);
  FakeSocket.instances[0]?.close();
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 2500 });
  expect(FakeSocket.instances[1]?.protocol).toBe(refreshedToken);
  unsubscribe();
});

it("uses updated app metadata after a failed refresh without replacing the subscription", async () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const oldToken = `${Date.now() - 1000}.old`;
  const newToken = `${Date.now() + 60_000}.new`;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Metadata unavailable.");
    }),
  );
  const manager = createPreviewManager(new URL("https://host.test/api/tailorkit/"), vi.fn());
  const app = (token: string) => ({
    id: "app",
    preview: {
      sessionId,
      expiresAt: "later",
      websocketUrl: "wss://platform.test/preview",
      token,
    },
  });
  const unsubscribe = manager.subscribe(app(oldToken), vi.fn());
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  manager.updateApp(app(newToken));
  FakeSocket.instances[0]?.close();
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 2500 });
  expect(FakeSocket.instances[1]?.protocol).toBe(newToken);
  unsubscribe();
});

afterEach(() => {
  state.release?.();
  state.release = undefined;
  state.hold = false;
  vi.unstubAllGlobals();
  FakeSocket.instances = [];
  state.events = [];
  state.batches = [];
});

it("keeps the last complete build through a corrupt transfer and recovers after reconnect", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sessionId: "session",
        websocketUrl: "wss://platform.test/preview",
        token: "token",
      }),
    })),
  );
  const buildEvents = (revision: number, source: string, chunk: string): PreviewEvent[] => {
    const bytes = Buffer.from(source);
    return [
      {
        type: "begin",
        buildId: `build-${revision}`,
        revision,
        manifest: {
          files: [
            {
              path: "client.js",
              contentType: "text/javascript",
              size: bytes.length,
              chunks: 1,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          ],
        },
      },
      {
        type: "chunk",
        revision,
        fileIndex: 0,
        chunkIndex: 0,
        base64: Buffer.from(chunk).toString("base64"),
      },
      { type: "complete", revision },
    ];
  };
  state.batches = [
    buildEvents(1, "original", "original"),
    buildEvents(2, "replacement", "REPLACEMENT"),
    buildEvents(2, "replacement", "replacement"),
  ];
  const manager = createPreviewManager(new URL("https://host.test/api/tailorkit/"), vi.fn());
  const unsubscribe = manager.subscribe(
    {
      id: "app",
      preview: {
        sessionId: "session",
        expiresAt: "later",
        websocketUrl: "wss://platform.test/preview",
        token: "token",
      },
    },
    vi.fn(),
  );
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  FakeSocket.instances[0]?.open();
  await vi.waitFor(() =>
    expect(manager.getSnapshot("session")).toEqual({ revision: 1, source: "original" }),
  );
  FakeSocket.instances[0]?.close();
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 2500 });
  FakeSocket.instances[1]?.open();
  await vi.waitFor(() => expect(state.batches).toHaveLength(1));
  expect(manager.getSnapshot("session")).toEqual({ revision: 1, source: "original" });
  FakeSocket.instances[1]?.close();
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(3), { timeout: 2500 });
  FakeSocket.instances[2]?.open();
  await vi.waitFor(() =>
    expect(manager.getSnapshot("session")).toEqual({ revision: 2, source: "replacement" }),
  );
  unsubscribe();
  expect(FakeSocket.instances[2]?.closed).toBe(true);
});

it("keeps a reconnect's candidate when an older checksum finishes", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sessionId: "session",
        websocketUrl: "wss://platform.test/preview",
        token: "token",
      }),
    })),
  );
  const oldDigest = Promise.withResolvers<ArrayBuffer>();
  const newDigest = Promise.withResolvers<ArrayBuffer>();
  let digestCalls = 0;
  vi.stubGlobal("crypto", {
    subtle: {
      digest: () => (++digestCalls === 1 ? oldDigest.promise : newDigest.promise),
    },
  });
  const buildEvents = (revision: number, source: string): PreviewEvent[] => {
    const bytes = Buffer.from(source);
    return [
      {
        type: "begin",
        buildId: `build-${revision}`,
        revision,
        manifest: {
          files: [
            {
              path: "client.js",
              contentType: "text/javascript",
              size: bytes.length,
              chunks: 1,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          ],
        },
      },
      { type: "chunk", revision, fileIndex: 0, chunkIndex: 0, base64: bytes.toString("base64") },
      { type: "complete", revision },
    ];
  };
  state.batches = [buildEvents(1, "old"), buildEvents(2, "new")];
  const manager = createPreviewManager(new URL("https://host.test/api/tailorkit/"), vi.fn());
  const unsubscribe = manager.subscribe(
    {
      id: "app",
      preview: {
        sessionId: "session",
        expiresAt: "later",
        websocketUrl: "wss://platform.test/preview",
        token: "token",
      },
    },
    vi.fn(),
  );
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  FakeSocket.instances[0]?.open();
  await vi.waitFor(() => expect(digestCalls).toBe(1));
  FakeSocket.instances[0]?.close();
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 2500 });
  FakeSocket.instances[1]?.open();
  await vi.waitFor(() => expect(digestCalls).toBe(2));
  oldDigest.resolve(Uint8Array.from(createHash("sha256").update("old").digest()).buffer);
  await new Promise((resolve) => setTimeout(resolve, 0));
  newDigest.resolve(Uint8Array.from(createHash("sha256").update("new").digest()).buffer);
  await vi.waitFor(() =>
    expect(manager.getSnapshot("session")).toEqual({ revision: 2, source: "new" }),
  );
  unsubscribe();
});

it("clears the published preview before refreshing apps when a session ends", async () => {
  state.hold = true;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sessionId: "session",
        websocketUrl: "wss://platform.test/preview",
        token: "token",
      }),
    })),
  );
  const source = "export default 1";
  const bytes = Buffer.from(source);
  state.events = [
    {
      type: "begin",
      buildId: "build",
      revision: 1,
      manifest: {
        files: [
          {
            path: "client.js",
            contentType: "text/javascript",
            size: bytes.length,
            chunks: 1,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ],
      },
    },
    { type: "chunk", revision: 1, fileIndex: 0, chunkIndex: 0, base64: bytes.toString("base64") },
    { type: "complete", revision: 1 },
  ];
  const snapshots: { revision: number; source: string | null }[] = [];
  const endedSnapshots: { revision: number; source: string | null }[] = [];
  const onEnded = vi.fn(() => {
    endedSnapshots.push(manager.getSnapshot("session"));
  });
  const manager = createPreviewManager(new URL("https://host.test/api/tailorkit/"), onEnded);
  const unsubscribe = manager.subscribe(
    {
      id: "app",
      preview: {
        sessionId: "session",
        expiresAt: "later",
        websocketUrl: "wss://platform.test/preview",
        token: "token",
      },
    },
    () => {
      snapshots.push(manager.getSnapshot("session"));
      if (snapshots.length === 1) {
        state.events.push({ type: "ended" });
      }
    },
  );
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  FakeSocket.instances[0]?.open();
  await vi.waitFor(() => expect(onEnded).toHaveBeenCalledOnce());
  expect(endedSnapshots).toEqual([{ revision: 0, source: null }]);
  expect(snapshots).toEqual([
    { revision: 1, source },
    { revision: 0, source: null },
  ]);
  expect(manager.getSnapshot("session")).toEqual({ revision: 0, source: null });
  unsubscribe();
});

it("shares one socket, applies only complete checksummed revisions, and closes on last unsubscribe", async () => {
  state.hold = true;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sessionId: "session",
        websocketUrl: "wss://platform.test/preview",
        token: "token",
      }),
    })),
  );
  const source = "export default 1";
  const bytes = Buffer.from(source);
  state.events = [
    {
      type: "begin",
      buildId: "build",
      revision: 1,
      manifest: {
        files: [
          {
            path: "client.js",
            contentType: "text/javascript",
            size: bytes.length,
            chunks: 1,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ],
      },
    },
    { type: "chunk", revision: 1, fileIndex: 0, chunkIndex: 0, base64: bytes.toString("base64") },
    { type: "complete", revision: 1 },
  ];
  const manager = createPreviewManager(new URL("https://host.test/api/tailorkit/"), vi.fn());
  const app = {
    id: "app",
    preview: {
      sessionId: "session",
      expiresAt: "later",
      websocketUrl: "wss://platform.test/preview",
      token: "token",
    },
  };
  const listener = vi.fn();
  const first = manager.subscribe(app, listener);
  const second = manager.subscribe(app, vi.fn());
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  FakeSocket.instances[0]?.open();
  await vi.waitFor(() => expect(manager.getSnapshot("session")).toEqual({ revision: 1, source }));
  first();
  expect(FakeSocket.instances[0]?.closed).toBe(false);
  second();
  expect(FakeSocket.instances[0]?.closed).toBe(true);
});
