import { describe, expect, it, vi } from "vite-plus/test";
import { createPreviewPresence, previewLeaseSeconds } from "./preview-presence.js";
import type { KV } from "./types.js";

function createKV(values = new Map<string, string>()): KV {
  return {
    delete: vi.fn((key: string) => {
      values.delete(key);
      return Promise.resolve();
    }),
    engine: {} as never,
    get: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    getAndDelete: vi.fn((key: string) => {
      const value = values.get(key) ?? null;
      values.delete(key);
      return Promise.resolve(value);
    }),
    claimUpload: vi.fn(),
    setPreviewPresenceIfActive: vi.fn(),
    keepPreviewSessionIfDeveloperPresent: vi.fn(),
    increment: vi.fn(),
    publish: vi.fn(),
    set: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    promoteIfOwnerAndNewer: vi.fn(),
    subscribe: vi.fn(),
    type: "redis",
  };
}
describe("preview presence", () => {
  it("uses a renewing TTL lease rather than a durable connection record", async () => {
    const kv = createKV();
    const presence = createPreviewPresence(kv);
    await presence.heartbeat("session_123", { connectionId: "connection_123", revision: 4 });
    expect(kv.set).toHaveBeenCalledWith(
      "preview:developer-connection:session_123",
      JSON.stringify({ connectionId: "connection_123", revision: 4 }),
      { ttl: previewLeaseSeconds },
    );
    expect(kv.publish).toHaveBeenCalledWith(
      "preview:developer-events:session_123",
      JSON.stringify({ connectionId: "connection_123", revision: 4 }),
    );
    await expect(presence.get("session_123")).resolves.toEqual({
      connectionId: "connection_123",
      revision: 4,
    });
  });
  it("treats an absent or malformed lease as offline", async () => {
    const presence = createPreviewPresence(
      createKV(new Map([["preview:developer-connection:broken", "not-json"]])),
    );
    await expect(presence.get("missing")).resolves.toBeNull();
    await expect(presence.get("broken")).resolves.toBeNull();
  });

  it("keeps the authoritative lease when pub/sub notification fails", async () => {
    const kv = createKV();
    vi.mocked(kv.publish).mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(
      createPreviewPresence(kv).heartbeat("session_123", {
        connectionId: "connection_123",
        revision: 4,
      }),
    ).resolves.toBeUndefined();
    await expect(createPreviewPresence(kv).get("session_123")).resolves.toEqual({
      connectionId: "connection_123",
      revision: 4,
    });
  });

  it("rejects identifiers that could escape the Redis key namespace", async () => {
    const presence = createPreviewPresence(createKV());

    await expect(
      presence.heartbeat("session:other", { connectionId: "connection_123", revision: 0 }),
    ).rejects.toMatchObject({
      name: "TypeError",
      message: "Preview session id must be an opaque identifier.",
    });
  });

  it("forwards only valid connection-change events to subscribers", async () => {
    const kv = createKV();
    const presence = createPreviewPresence(kv);
    const handler = vi.fn();
    let listener: ((message: string) => void) | undefined;
    vi.mocked(kv.subscribe).mockImplementation((_channel, nextListener) => {
      listener = nextListener;
      return Promise.all([]).then(() => () => Promise.resolve());
    });

    await presence.subscribe("session_123", handler);
    listener?.("not-json");
    listener?.(JSON.stringify({ connectionId: 5, revision: 3 }));
    listener?.(JSON.stringify({ connectionId: "connection_123", revision: 5 }));

    expect(kv.subscribe).toHaveBeenCalledWith(
      "preview:developer-events:session_123",
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ connectionId: "connection_123", revision: 5 });
  });
});
