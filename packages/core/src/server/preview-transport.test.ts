import { asyncIteratorObject, os } from "@orpc/server";
import { experimental_RPCHandler as RPCHandler } from "@orpc/server/crossws";
import {
  createPreviewWebSocketClient,
  previewEventSchema,
} from "@tailorkit/client-platform/preview";
import { expect, it } from "vite-plus/test";
import { z } from "zod";

it("round trips preview calls, full upload chunks, and streamed events over the v2 wire format", async () => {
  const upload = z.object({ base64: z.string() });
  const handler = new RPCHandler({
    heartbeat: os.handler(() => ({ accepted: true as const })),
    uploadChunk: os.input(upload).handler(({ input }) => {
      expect(Buffer.from(input.base64, "base64").byteLength).toBe(256 * 1024);
      return { accepted: true as const };
    }),
    subscribe: os.output(asyncIteratorObject(previewEventSchema)).handler(async function* () {
      yield { type: "ended" as const };
    }),
  });
  const events = new EventTarget();
  const pending: Promise<unknown>[] = [];
  const peer = {
    send: (data: string | Uint8Array) => {
      events.dispatchEvent(new MessageEvent("message", { data }));
    },
  };
  const socket = {
    readyState: 1,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    send: (rawData: string | Uint8Array) => {
      expect(
        typeof rawData === "string" ? Buffer.byteLength(rawData) : rawData.byteLength,
      ).toBeLessThan(512 * 1024);
      pending.push(
        handler.message(peer, {
          rawData,
          uint8Array: () =>
            typeof rawData === "string" ? new TextEncoder().encode(rawData) : rawData,
        }),
      );
    },
  };
  const client = createPreviewWebSocketClient(socket as unknown as WebSocket);

  try {
    await expect(client.heartbeat()).resolves.toEqual({ accepted: true });
    await expect(
      client.uploadChunk({
        buildId: "build_1",
        fileIndex: 0,
        chunkIndex: 0,
        base64: Buffer.alloc(256 * 1024).toString("base64"),
      }),
    ).resolves.toEqual({ accepted: true });
    const stream = await client.subscribe();
    const received = [];
    for await (const event of stream) received.push(event);
    expect(received).toEqual([{ type: "ended" }]);
    await Promise.all(pending);
  } finally {
    await handler.close(peer);
    events.dispatchEvent(new Event("close"));
  }
});
