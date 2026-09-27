/* oxlint-disable require-await, unicorn/no-await-expression-member -- the RPC mock acknowledges calls asynchronously. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { PreviewWebSocketClient } from "@tailorkit/client-platform/preview";
import {
  capturePreviewSnapshot,
  createLatestPreviewCapture,
  uploadPreviewSnapshot,
} from "./preview";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("discards a stale snapshot that finishes after a later rebuild", async () => {
  const older = Promise.withResolvers<string>();
  const newer = Promise.withResolvers<string>();
  const published: string[] = [];
  let attempts = 0;
  const capture = createLatestPreviewCapture(
    () => (++attempts === 1 ? older.promise : newer.promise),
    (snapshot) => published.push(snapshot),
    () => {},
  );

  const first = capture();
  const second = capture();
  newer.resolve("newer");
  await second;
  older.resolve("older");
  await first;

  expect(published).toEqual(["newer"]);
});

it("uploads a build larger than 4.5 MiB in sequential bounded messages", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-preview-"));
  dirs.push(root);
  await writeFile(path.join(root, "client.js"), Buffer.alloc(900_000, 1));
  for (let index = 0; index < 5; index++) {
    await writeFile(path.join(root, `asset-${index}.js`), Buffer.alloc(900_000, index + 2));
  }
  const snapshot = await capturePreviewSnapshot(root);
  expect(snapshot.manifest.files.reduce((total, file) => total + file.size, 0)).toBeGreaterThan(
    4.5 * 1024 * 1024,
  );
  const calls: string[] = [];
  let awaitingAck = false;
  let largestUploadMessage = 0;
  let largestViewerMessage = 0;
  const client = {
    beginBuild: vi.fn(async (input: { manifest: unknown }) => {
      calls.push("begin");
      expect(
        Buffer.byteLength(JSON.stringify({ id: 1, method: "beginBuild", params: input })),
      ).toBeLessThan(512 * 1024);
      return { buildId: "build" };
    }),
    uploadChunk: vi.fn(async (input: { base64: string; fileIndex: number; chunkIndex: number }) => {
      expect(awaitingAck).toBe(false);
      awaitingAck = true;
      calls.push("chunk");
      largestUploadMessage = Math.max(
        largestUploadMessage,
        Buffer.byteLength(JSON.stringify({ id: 1, method: "uploadChunk", params: input })),
      );
      largestViewerMessage = Math.max(
        largestViewerMessage,
        Buffer.byteLength(
          JSON.stringify({
            id: 1,
            event: {
              type: "chunk",
              revision: 1,
              fileIndex: input.fileIndex,
              chunkIndex: input.chunkIndex,
              base64: input.base64,
            },
          }),
        ),
      );
      expect(Buffer.from(input.base64, "base64").length).toBeLessThanOrEqual(256 * 1024);
      await new Promise((resolve) => setTimeout(resolve, 0));
      awaitingAck = false;
      return { accepted: true as const };
    }),
    commitBuild: vi.fn(async () => {
      calls.push("commit");
      return { revision: 1 };
    }),
  } as unknown as PreviewWebSocketClient;
  await uploadPreviewSnapshot(client, snapshot);
  expect(calls[0]).toBe("begin");
  expect(calls.at(-1)).toBe("commit");
  expect(calls.filter((value) => value === "chunk")).toHaveLength(24);
  expect(largestUploadMessage).toBeLessThan(512 * 1024);
  expect(largestViewerMessage).toBeLessThan(512 * 1024);
  expect(largestUploadMessage).toBeLessThan(4.5 * 1_000_000);
});

it("chunks exact boundaries and the largest allowed aggregate build", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-preview-"));
  dirs.push(root);
  for (let index = 0; index < 10; index++) {
    await writeFile(
      path.join(root, index === 0 ? "client.js" : `asset-${index}.js`),
      Buffer.alloc(1024 * 1024, index),
    );
  }
  const snapshot = await capturePreviewSnapshot(root);
  expect(snapshot.manifest.files.reduce((total, file) => total + file.size, 0)).toBe(
    10 * 1024 * 1024,
  );
  expect(snapshot.manifest.files.map((file) => file.chunks)).toEqual(
    Array.from({ length: 10 }, () => 4),
  );
  const sent: { fileIndex: number; chunkIndex: number; base64: string }[] = [];
  const client = {
    beginBuild: async () => ({ buildId: "build" }),
    uploadChunk: async (input: { fileIndex: number; chunkIndex: number; base64: string }) => {
      sent.push(input);
      return { accepted: true as const };
    },
    commitBuild: async () => ({ revision: 1 }),
    heartbeat: async () => ({ accepted: true as const }),
    subscribe: async () => (async function* empty() {})(),
  } as PreviewWebSocketClient;
  await uploadPreviewSnapshot(client, snapshot);
  expect(sent).toHaveLength(40);
  for (const [fileIndex, source] of snapshot.files.entries()) {
    const parts = sent.filter((part) => part.fileIndex === fileIndex);
    expect(parts.map((part) => part.chunkIndex)).toEqual([0, 1, 2, 3]);
    const reassembled = Buffer.concat(parts.map((part) => Buffer.from(part.base64, "base64")));
    expect(reassembled.length).toBe(source.length);
    expect(reassembled.equals(source)).toBe(true);
    for (const part of parts) {
      expect(
        Buffer.byteLength(JSON.stringify({ id: 1, method: "uploadChunk", params: part })),
      ).toBeLessThan(512 * 1024);
    }
  }
}, 30_000);

it("detects unchanged output and refuses an oversized rebuild snapshot", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-preview-"));
  dirs.push(root);
  await writeFile(path.join(root, "client.js"), "export default 1");
  const first = await capturePreviewSnapshot(root);
  const unchanged = await capturePreviewSnapshot(root);
  expect(unchanged.fingerprint).toBe(first.fingerprint);
  await writeFile(path.join(root, "client.js"), "export default 2");
  expect((await capturePreviewSnapshot(root)).fingerprint).not.toBe(first.fingerprint);
  await writeFile(path.join(root, "client.js"), Buffer.alloc(1024 * 1024 + 1));
  await expect(capturePreviewSnapshot(root)).rejects.toThrow("exceeds 1 MiB");
});
