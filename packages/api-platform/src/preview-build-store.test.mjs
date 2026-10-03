/* oxlint-disable require-await, require-unicode-regexp, unicorn/no-await-expression-member -- the in-memory KV fake mirrors async adapter methods. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vite-plus/test";
import {
  createPreviewBuildStore,
  previewChunkBytes,
  previewMessageBytes,
} from "./preview-build-store.ts";

function fakeKV() {
  const data = new Map();
  const expiries = new Map();
  const listeners = new Map();
  let revision = 0;
  let now = 0;
  const get = (key) => {
    const expiresAt = expiries.get(key);
    if (expiresAt !== undefined && expiresAt <= now) {
      data.delete(key);
      expiries.delete(key);
    }
    return data.get(key) ?? null;
  };
  const set = (key, value, options) => {
    data.set(key, value);
    if (options?.ttl) {
      expiries.set(key, now + options.ttl * 1000);
    } else {
      expiries.delete(key);
    }
  };
  const remove = (key) => {
    data.delete(key);
    expiries.delete(key);
  };
  return {
    advance: (milliseconds) => {
      now += milliseconds;
    },
    get: async (key) => get(key),
    getAndDelete: async (key) => {
      const value = get(key);
      remove(key);
      return value;
    },
    set: async (key, value, options) => {
      set(key, value, options);
    },
    claimUpload: async (ownerKey, endedKey, expectedOwner, newOwner, ttl) => {
      if (get(endedKey) !== null || get(ownerKey) !== expectedOwner) {
        return false;
      }
      set(ownerKey, newOwner, { ttl });
      return true;
    },
    promoteIfOwnerAndNewer: async (
      key,
      ownerKey,
      endedKey,
      expectedOwner,
      value,
      revision,
      ttl,
    ) => {
      if (get(endedKey) !== null) {
        return false;
      }
      if (get(ownerKey) !== expectedOwner) {
        return false;
      }
      const current = get(key);
      if (current && JSON.parse(current).revision >= revision) {
        return false;
      }
      set(key, value, { ttl });
      remove(ownerKey);
      return true;
    },
    delete: async (key) => {
      remove(key);
    },
    increment: async () => ++revision,
    publish: async (channel, message) => {
      for (const listener of listeners.get(channel) ?? []) {
        listener(message);
      }
      return listeners.get(channel)?.size ?? 0;
    },
    subscribe: async (channel, listener) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return async () => {
        set.delete(listener);
      };
    },
  };
}

const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestFor = (files) => ({
  files: files.map(([path, bytes]) => ({
    path,
    contentType: "text/javascript",
    size: bytes.length,
    chunks: Math.ceil(bytes.length / previewChunkBytes),
    sha256: checksum(bytes),
  })),
});

test("only complete verified builds replace the current pointer", async () => {
  const kv = fakeKV();
  const store = createPreviewBuildStore(kv);
  const first = Buffer.from("first");
  const firstId = await store.begin(
    "session",
    manifestFor([
      ["client.js", first],
      ["removed.js", Buffer.alloc(0)],
    ]),
  );
  await assert.rejects(store.commit("session", firstId), /incomplete/);
  assert.equal(await store.current("session"), null);
  await store.upload("session", firstId, 0, 0, first.toString("base64"));
  const committed = await store.commit("session", firstId);
  assert.equal(committed.revision, 1);
  assert.equal(await store.chunk("session", firstId, 0, 0), first.toString("base64"));

  const second = Buffer.from("second");
  const secondId = await store.begin("session", manifestFor([["client.js", second]]));
  await assert.rejects(store.upload("session", secondId, 0, 0, first.toString("base64")), /size/);
  await store.upload("session", secondId, 0, 0, second.toString("base64"));
  await store.commit("session", secondId);
  assert.deepEqual(
    (await store.current("session")).manifest.files.map((file) => file.path),
    ["client.js"],
  );
  await store.end("session");
  assert.equal(await store.current("session"), null);
  assert.equal(await store.chunk("session", secondId, 0, 0), null);
  assert.equal(await kv.get(`preview:build:session:${secondId}`), null);
  assert.equal(await kv.get(`preview:build:session:${secondId}:0:0`), null);
  assert.equal(await kv.get("preview:ended:session"), "1");
});

test("committed chunks remain readable after the upload TTL expires", async () => {
  const kv = fakeKV();
  const store = createPreviewBuildStore(kv);
  const bytes = Buffer.from("export default 1");
  const buildId = await store.begin("session", manifestFor([["client.js", bytes]]));
  const base64 = bytes.toString("base64");
  await store.upload("session", buildId, 0, 0, base64);
  await store.commit("session", buildId);

  kv.advance(15 * 60 * 1000 + 1);
  assert.equal(await store.chunk("session", buildId, 0, 0), base64);
  assert.equal((await store.current("session")).buildId, buildId);
});

test("a failed pointer write leaves a verified build retryable with the same revision", async () => {
  const kv = fakeKV();
  const store = createPreviewBuildStore(kv);
  const first = Buffer.from("first");
  const firstId = await store.begin("session", manifestFor([["client.js", first]]));
  await store.upload("session", firstId, 0, 0, first.toString("base64"));
  await store.commit("session", firstId);

  const next = Buffer.from("next");
  const nextId = await store.begin("session", manifestFor([["client.js", next]]));
  await store.upload("session", nextId, 0, 0, next.toString("base64"));
  const write = kv.promoteIfOwnerAndNewer;
  let failPointer = true;
  kv.promoteIfOwnerAndNewer = async (
    key,
    ownerKey,
    endedKey,
    expectedOwner,
    value,
    revision,
    ttl,
  ) => {
    if (key === "preview:current:session" && failPointer) {
      failPointer = false;
      throw new Error("pointer write failed");
    }
    return write(key, ownerKey, endedKey, expectedOwner, value, revision, ttl);
  };
  await assert.rejects(store.commit("session", nextId), /pointer write failed/);
  assert.equal((await store.current("session")).buildId, firstId);
  assert.equal(await kv.get("preview:uploading:session"), nextId);
  assert.equal(JSON.parse(await kv.get(`preview:build:session:${nextId}`)).state, "ready");

  const committed = await store.commit("session", nextId);
  assert.equal(committed.revision, 2);
  assert.equal((await store.current("session")).buildId, nextId);
  assert.equal(await store.chunk("session", nextId, 0, 0), next.toString("base64"));
});

test("an older concurrent commit cannot replace a newer current revision", async () => {
  const kv = fakeKV();
  const store = createPreviewBuildStore(kv);
  const bytes = Buffer.from("same build");
  const buildId = await store.begin("session", manifestFor([["client.js", bytes]]));
  await store.upload("session", buildId, 0, 0, bytes.toString("base64"));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const write = kv.set;
  kv.set = async (key, value, options) => {
    if (key === `preview:build:session:${buildId}` && JSON.parse(value).revision === 1) {
      entered.resolve();
      await release.promise;
    }
    return write(key, value, options);
  };
  const older = store.commit("session", buildId);
  await entered.promise;
  const newer = await store.commit("session", buildId);
  release.resolve();
  await assert.rejects(older, /superseded/);
  assert.equal(newer.revision, 2);
  assert.equal((await store.current("session")).revision, 2);
});

test("a cancelled upload cannot promote after a replacement begin", async () => {
  const kv = fakeKV();
  const store = createPreviewBuildStore(kv);
  const old = Buffer.from("visible");
  const oldId = await store.begin("session", manifestFor([["client.js", old]]));
  await store.upload("session", oldId, 0, 0, old.toString("base64"));
  await store.commit("session", oldId);

  const interrupted = Buffer.from("interrupted");
  const interruptedId = await store.begin("session", manifestFor([["client.js", interrupted]]));
  await store.upload("session", interruptedId, 0, 0, interrupted.toString("base64"));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const promote = kv.promoteIfOwnerAndNewer;
  kv.promoteIfOwnerAndNewer = async (...args) => {
    if (args[3] === interruptedId) {
      entered.resolve();
      await release.promise;
    }
    return promote(...args);
  };
  const pending = store.commit("session", interruptedId);
  await entered.promise;
  const replacement = Buffer.from("replacement");
  const replacementId = await store.begin("session", manifestFor([["client.js", replacement]]));
  release.resolve();
  await assert.rejects(pending, /cancelled or superseded/);
  assert.equal((await store.current("session")).buildId, oldId);
  assert.equal(await kv.get(`preview:build:session:${interruptedId}`), null);
  assert.equal(await kv.get(`preview:build:session:${interruptedId}:0:0`), null);
  await store.upload("session", replacementId, 0, 0, replacement.toString("base64"));
  await store.commit("session", replacementId);
  assert.equal((await store.current("session")).buildId, replacementId);
});

test("an in-flight commit cannot restore a preview after session end", async () => {
  const kv = fakeKV();
  const store = createPreviewBuildStore(kv);
  const bytes = Buffer.from("late build");
  const buildId = await store.begin("session", manifestFor([["client.js", bytes]]));
  await store.upload("session", buildId, 0, 0, bytes.toString("base64"));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const promote = kv.promoteIfOwnerAndNewer;
  kv.promoteIfOwnerAndNewer = async (...args) => {
    entered.resolve();
    await release.promise;
    return promote(...args);
  };
  const pending = store.commit("session", buildId);
  await entered.promise;
  await store.end("session");
  release.resolve();
  await assert.rejects(pending, /cancelled or superseded/);
  assert.equal(await kv.get("preview:current:session"), null);
  assert.equal(await store.current("session"), null);
  await assert.rejects(store.begin("session", manifestFor([["client.js", bytes]])), /ended/);
});

test("reads builds committed before the retryable-state rollout", async () => {
  const kv = fakeKV();
  const store = createPreviewBuildStore(kv);
  const bytes = Buffer.from("published before rollout");
  await kv.set(
    "preview:build:session:legacy",
    JSON.stringify({ manifest: manifestFor([["client.js", bytes]]), state: "committed" }),
  );
  await kv.set("preview:build:session:legacy:0:0", bytes.toString("base64"));
  assert.equal(await store.chunk("session", "legacy", 0, 0), bytes.toString("base64"));
});

test("large aggregate builds use bounded chunks and messages", async () => {
  const store = createPreviewBuildStore(fakeKV());
  const files = Array.from({ length: 6 }, (_, index) => [
    index === 0 ? "client.js" : `file-${index}.js`,
    Buffer.alloc(900_000, index),
  ]);
  const id = await store.begin("session", manifestFor(files));
  for (const [fileIndex, [, bytes]] of files.entries()) {
    for (
      let chunkIndex = 0;
      chunkIndex < Math.ceil(bytes.length / previewChunkBytes);
      chunkIndex++
    ) {
      const base64 = bytes
        .subarray(chunkIndex * previewChunkBytes, (chunkIndex + 1) * previewChunkBytes)
        .toString("base64");
      assert.ok(
        Buffer.byteLength(JSON.stringify({ fileIndex, chunkIndex, base64 })) < previewMessageBytes,
      );
      await store.upload("session", id, fileIndex, chunkIndex, base64);
    }
  }
  assert.equal((await store.commit("session", id)).manifest.files.length, 6);
});

test("corrupt and missing chunks never become visible", async () => {
  const store = createPreviewBuildStore(fakeKV());
  const bytes = Buffer.alloc(previewChunkBytes + 3, 7);
  const id = await store.begin("session", manifestFor([["client.js", bytes]]));
  await store.upload("session", id, 0, 0, bytes.subarray(0, previewChunkBytes).toString("base64"));
  await assert.rejects(store.commit("session", id), /incomplete/);
  await store.upload("session", id, 0, 1, Buffer.from([1, 2, 3]).toString("base64"));
  await assert.rejects(store.commit("session", id), /checksum/);
  assert.equal(await store.current("session"), null);
  await assert.rejects(
    store.upload("session", id, 0, 1, bytes.subarray(previewChunkBytes).toString("base64")),
    /Conflicting/,
  );
});

test("begin replaces only the previous unfinished upload and removes its chunks", async () => {
  const kv = fakeKV();
  const store = createPreviewBuildStore(kv);
  const oldBytes = Buffer.alloc(previewChunkBytes + 1, 7);
  const extraBytes = Buffer.from("old asset");
  const oldId = await store.begin(
    "session",
    manifestFor([
      ["client.js", oldBytes],
      ["asset.js", extraBytes],
    ]),
  );
  await store.upload(
    "session",
    oldId,
    0,
    0,
    oldBytes.subarray(0, previewChunkBytes).toString("base64"),
  );
  await store.upload(
    "session",
    oldId,
    0,
    1,
    oldBytes.subarray(previewChunkBytes).toString("base64"),
  );
  await store.upload("session", oldId, 1, 0, extraBytes.toString("base64"));
  const nextBytes = Buffer.from("new build");
  const nextId = await store.begin("session", manifestFor([["client.js", nextBytes]]));
  assert.equal(await kv.get(`preview:build:session:${oldId}`), null);
  assert.equal(await kv.get(`preview:build:session:${oldId}:0:0`), null);
  assert.equal(await kv.get(`preview:build:session:${oldId}:0:1`), null);
  assert.equal(await kv.get(`preview:build:session:${oldId}:1:0`), null);
  assert.equal(await kv.get("preview:uploading:session"), nextId);
  await assert.rejects(
    store.upload("session", oldId, 0, 0, oldBytes.toString("base64")),
    /unavailable/,
  );
  await assert.rejects(store.commit("session", oldId), /unavailable/);
  await store.upload("session", nextId, 0, 0, nextBytes.toString("base64"));
  await store.commit("session", nextId);
  assert.equal(await kv.get("preview:uploading:session"), null);
  const abandonedId = await store.begin("session", manifestFor([["client.js", extraBytes]]));
  await store.upload("session", abandonedId, 0, 0, extraBytes.toString("base64"));
  assert.equal((await store.current("session")).buildId, nextId);
  await store.end("session");
  assert.equal(await kv.get(`preview:build:session:${abandonedId}`), null);
  assert.equal(await kv.get(`preview:build:session:${abandonedId}:0:0`), null);
});

test("revision subscription can be released", async () => {
  const kv = fakeKV();
  const store = createPreviewBuildStore(kv);
  const revisions = [];
  const unsubscribe = await store.subscribe("session", (revision) => revisions.push(revision));
  const empty = manifestFor([["client.js", Buffer.alloc(0)]]);
  await store.commit("session", await store.begin("session", empty));
  await store.end("session");
  assert.deepEqual(revisions, [1, null]);
  await unsubscribe();
  await kv.publish("preview:revision:session", JSON.stringify({ revision: 2, buildId: "later" }));
  assert.deepEqual(revisions, [1, null]);
});
