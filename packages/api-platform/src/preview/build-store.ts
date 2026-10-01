import { createHash, randomUUID } from "node:crypto";
import type { KV } from "@tailorkit/kv";
import { z } from "zod";
import { Effect } from "effect";
import { PreviewBuildError } from "./errors";
import type { PreviewStorageError } from "./errors";
import { createPreviewStorage } from "./storage";
import { previewChunkBytes, previewMessageBytes, previewSessionTtlSeconds } from "./constants";
import {
  previewIdentifierSchema,
  previewManifestSchema,
  validatePreviewManifest,
} from "./manifest";
import type { PreviewBuildManifest } from "./manifest";

const uploadTtlSeconds = 15 * 60;
const committedTtlSeconds = 10 * 60;

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const buildKey = (sessionId: string, buildId: string) => `preview:build:${sessionId}:${buildId}`;
const chunkKey = (sessionId: string, buildId: string, fileIndex: number, chunkIndex: number) =>
  `${buildKey(sessionId, buildId)}:${fileIndex}:${chunkIndex}`;
const pointerKey = (sessionId: string) => `preview:current:${sessionId}`;
const uploadingKey = (sessionId: string) => `preview:uploading:${sessionId}`;
const endedKey = (sessionId: string) => `preview:ended:${sessionId}`;
const channel = (sessionId: string) => `preview:revision:${sessionId}`;
const identifierSchema = previewIdentifierSchema;
const validate = <T>(run: () => T) =>
  Effect.try({
    try: run,
    catch: (cause) =>
      new PreviewBuildError({
        message: cause instanceof Error ? cause.message : "Invalid preview build.",
        cause,
      }),
  });
const failBuild = (message: string) => Effect.fail(new PreviewBuildError({ message }));
const requireId = (value: string) => validate(() => identifierSchema.parse(value));
const buildSchema = z.discriminatedUnion("state", [
  z.object({ manifest: previewManifestSchema, state: z.literal("uploading") }),
  z.object({
    manifest: previewManifestSchema,
    state: z.literal("ready"),
    revision: z.number().int().positive(),
  }),
  z.object({ manifest: previewManifestSchema, state: z.literal("committed") }),
]);
const committedSchema = z.object({
  buildId: identifierSchema,
  manifest: previewManifestSchema,
  revision: z.number().int().positive(),
});
const notificationSchema = z.union([
  z.object({ ended: z.literal(true) }),
  z.object({ revision: z.number().int().positive(), buildId: identifierSchema }),
]);
const base64Schema = z
  .string()
  .max(4 * Math.ceil(previewChunkBytes / 3))
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const parse = <T>(value: string | null, schema: z.ZodType<T>) =>
  validate(() => (value === null ? null : schema.parse(JSON.parse(value) as unknown)));
export function createPreviewBuildStoreEffects(kv: KV) {
  const storage = createPreviewStorage(kv);
  const readBuild = Effect.fn("preview.readBuild")(function* (sessionId: string, buildId: string) {
    return yield* parse(yield* storage.get(buildKey(sessionId, buildId)), buildSchema);
  });
  const removeUploadingBuild = Effect.fn("preview.removeUploadingBuild")(function* (
    sessionId: string,
    buildId: string,
  ) {
    const build = yield* readBuild(sessionId, buildId);
    const pointer = yield* parse(yield* storage.get(pointerKey(sessionId)), committedSchema);
    if (!build || pointer?.buildId === buildId) {
      return;
    }
    for (const [fileIndex, file] of build.manifest.files.entries()) {
      for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
        yield* storage.delete(chunkKey(sessionId, buildId, fileIndex, chunkIndex));
      }
    }
    yield* storage.delete(buildKey(sessionId, buildId));
  });
  const current = Effect.fn("preview.current")(function* (sessionId: string) {
    yield* requireId(sessionId);
    if (yield* storage.get(endedKey(sessionId))) {
      return null;
    }
    return yield* parse(yield* storage.get(pointerKey(sessionId)), committedSchema);
  });
  return {
    begin: Effect.fn("preview.begin")(function* (
      sessionId: string,
      manifest: PreviewBuildManifest,
    ) {
      yield* requireId(sessionId);
      if (yield* storage.get(endedKey(sessionId))) {
        return yield* failBuild("Preview session has ended.");
      }
      yield* validate(() => validatePreviewManifest(manifest));
      const previous = yield* storage.get(uploadingKey(sessionId));
      if (previous) {
        yield* requireId(previous);
      }
      const buildId = randomUUID();
      yield* storage.set(
        buildKey(sessionId, buildId),
        JSON.stringify({ manifest, state: "uploading" }),
        {
          ttl: uploadTtlSeconds,
        },
      );
      const claimed = yield* storage.claimUpload(
        uploadingKey(sessionId),
        endedKey(sessionId),
        previous,
        buildId,
        uploadTtlSeconds,
      );
      if (!claimed) {
        yield* storage.delete(buildKey(sessionId, buildId));
        return yield* failBuild("Preview upload was cancelled or superseded.");
      }
      if (previous) {
        // The previous upload is bounded by its KV TTL.
        yield* removeUploadingBuild(sessionId, previous).pipe(Effect.ignore);
      }
      return buildId;
    }),
    upload: Effect.fn("preview.upload")(function* (
      sessionId: string,
      buildId: string,
      fileIndex: number,
      chunkIndex: number,
      base64: string,
    ) {
      yield* requireId(sessionId);
      yield* requireId(buildId);
      if (yield* storage.get(endedKey(sessionId))) {
        return yield* failBuild("Preview session has ended.");
      }
      if ((yield* storage.get(uploadingKey(sessionId))) !== buildId) {
        return yield* failBuild("Preview upload is unavailable.");
      }
      const build = yield* readBuild(sessionId, buildId);
      if (build?.state !== "uploading") {
        return yield* failBuild("Preview upload is unavailable.");
      }
      const file = build.manifest.files[fileIndex];
      if (
        !file ||
        !Number.isInteger(fileIndex) ||
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0 ||
        chunkIndex >= file.chunks
      ) {
        return yield* failBuild("Invalid preview chunk index.");
      }
      if (!base64Schema.safeParse(base64).success) {
        return yield* failBuild("Invalid preview chunk encoding.");
      }
      const bytes = Buffer.from(base64, "base64");
      const expected = Math.min(previewChunkBytes, file.size - chunkIndex * previewChunkBytes);
      if (
        bytes.length !== expected ||
        Buffer.byteLength(JSON.stringify({ sessionId, buildId, fileIndex, chunkIndex, base64 })) >
          previewMessageBytes
      ) {
        return yield* failBuild("Invalid preview chunk size.");
      }
      const key = chunkKey(sessionId, buildId, fileIndex, chunkIndex);
      const existing = yield* storage.get(key);
      if (existing !== null && existing !== base64) {
        return yield* failBuild("Conflicting preview chunk.");
      }
      yield* storage.set(key, base64, { ttl: uploadTtlSeconds });
    }),
    // oxlint-disable-next-line complexity -- commit verifies all chunks before advancing the pointer.
    commit: Effect.fn("preview.commit")(function* (sessionId: string, buildId: string) {
      yield* requireId(sessionId);
      yield* requireId(buildId);
      if (yield* storage.get(endedKey(sessionId))) {
        return yield* failBuild("Preview session has ended.");
      }
      if ((yield* storage.get(uploadingKey(sessionId))) !== buildId) {
        return yield* failBuild("Preview upload is unavailable.");
      }
      const build = yield* readBuild(sessionId, buildId);
      if (!build || build.state === "committed") {
        return yield* failBuild("Preview upload is unavailable.");
      }
      yield* validate(() => validatePreviewManifest(build.manifest));
      let revision = build.state === "ready" ? build.revision : 0;
      if (build.state === "uploading") {
        for (const [fileIndex, file] of build.manifest.files.entries()) {
          const parts: Buffer[] = [];
          for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
            const value = yield* storage.get(chunkKey(sessionId, buildId, fileIndex, chunkIndex));
            if (value === null) {
              return yield* failBuild("Preview build is incomplete.");
            }
            if (!base64Schema.safeParse(value).success) {
              return yield* failBuild("Corrupt preview chunk.");
            }
            const bytes = Buffer.from(value, "base64");
            if (
              bytes.length !==
              Math.min(previewChunkBytes, file.size - chunkIndex * previewChunkBytes)
            ) {
              return yield* failBuild("Corrupt preview chunk.");
            }
            parts.push(bytes);
          }
          const bytes = Buffer.concat(parts);
          if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
            return yield* failBuild("Preview checksum mismatch.");
          }
        }
        revision = yield* storage.increment(
          `preview:revision-counter:${sessionId}`,
          previewSessionTtlSeconds,
        );
        for (const [fileIndex, file] of build.manifest.files.entries()) {
          for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
            const key = chunkKey(sessionId, buildId, fileIndex, chunkIndex);
            const value = yield* storage.get(key);
            if (value === null) {
              return yield* failBuild("Preview build expired before commit.");
            }
            yield* storage.set(key, value, { ttl: previewSessionTtlSeconds });
          }
        }
        yield* storage.set(
          buildKey(sessionId, buildId),
          JSON.stringify({ manifest: build.manifest, state: "ready", revision }),
          {
            ttl: previewSessionTtlSeconds,
          },
        );
        const stillOwned = yield* storage.claimUpload(
          uploadingKey(sessionId),
          endedKey(sessionId),
          buildId,
          buildId,
          previewSessionTtlSeconds,
        );
        if (!stillOwned) {
          return yield* failBuild("Preview build was cancelled or superseded.");
        }
      }
      if (!revision) {
        return yield* failBuild("Preview build is unavailable.");
      }
      const committed = { buildId, manifest: build.manifest, revision };
      const previous = yield* current(sessionId);
      const promoted = yield* storage.promoteIfOwnerAndNewer(
        pointerKey(sessionId),
        uploadingKey(sessionId),
        endedKey(sessionId),
        buildId,
        JSON.stringify(committed),
        revision,
        previewSessionTtlSeconds,
      );
      if (!promoted) {
        const pointer = yield* current(sessionId);
        if (pointer?.buildId === buildId && pointer.revision === revision) {
          return committed;
        }
        // An abandoned build is still bounded by its KV TTL.
        yield* removeUploadingBuild(sessionId, buildId).pipe(Effect.ignore);
        return yield* failBuild("Preview build was cancelled or superseded.");
      }
      // The pointer is durable and TTLs bound cleanup.
      yield* Effect.gen(function* () {
        if (previous && previous.buildId !== buildId) {
          const previousBuild = yield* readBuild(sessionId, previous.buildId);
          if (previousBuild) {
            yield* storage.set(
              buildKey(sessionId, previous.buildId),
              JSON.stringify(previousBuild),
              {
                ttl: committedTtlSeconds,
              },
            );
            for (const [fileIndex, file] of previous.manifest.files.entries()) {
              for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
                const key = chunkKey(sessionId, previous.buildId, fileIndex, chunkIndex);
                const value = yield* storage.get(key);
                if (value !== null) {
                  yield* storage.set(key, value, { ttl: committedTtlSeconds });
                }
              }
            }
          }
        }
      }).pipe(Effect.ignore);
      // Polling recovers missed notifications.
      yield* storage
        .publish(channel(sessionId), JSON.stringify({ revision, buildId }))
        .pipe(Effect.ignore);
      return committed;
    }),
    current,
    chunk: Effect.fn("preview.chunk")(function* (
      sessionId: string,
      buildId: string,
      fileIndex: number,
      chunkIndex: number,
    ) {
      yield* requireId(sessionId);
      yield* requireId(buildId);
      if (yield* storage.get(endedKey(sessionId))) {
        return null;
      }
      const build = yield* readBuild(sessionId, buildId);
      if (build?.state !== "ready" && build?.state !== "committed") {
        return null;
      }
      if (
        !build.manifest.files[fileIndex] ||
        chunkIndex < 0 ||
        chunkIndex >= build.manifest.files[fileIndex].chunks
      ) {
        return null;
      }
      const value = yield* storage.get(chunkKey(sessionId, buildId, fileIndex, chunkIndex));
      return value !== null && base64Schema.safeParse(value).success ? value : null;
    }),
    subscribe: Effect.fn("preview.subscribe")(function* (
      sessionId: string,
      onRevision: (revision: number | null) => void,
    ) {
      yield* requireId(sessionId);
      return yield* storage.subscribe(channel(sessionId), (message) => {
        try {
          const value = notificationSchema.parse(JSON.parse(message) as unknown);
          if ("ended" in value) {
            onRevision(null);
            return;
          }
          onRevision(value.revision);
        } catch {
          /* Ignore malformed notifications. */
        }
      });
    }),
    end: Effect.fn("preview.end")(function* (sessionId: string) {
      yield* requireId(sessionId);
      yield* storage.set(endedKey(sessionId), "1", { ttl: previewSessionTtlSeconds });
      const active = yield* parse(yield* storage.get(pointerKey(sessionId)), committedSchema);
      const uploading = yield* storage.get(uploadingKey(sessionId));
      if (uploading) {
        yield* requireId(uploading);
        yield* removeUploadingBuild(sessionId, uploading);
      }
      if (active) {
        for (const [fileIndex, file] of active.manifest.files.entries()) {
          for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
            yield* storage.delete(chunkKey(sessionId, active.buildId, fileIndex, chunkIndex));
          }
        }
        yield* storage.delete(buildKey(sessionId, active.buildId));
      }
      yield* storage.delete(uploadingKey(sessionId));
      yield* storage.delete(pointerKey(sessionId));
      // The ended marker is authoritative; polling recovers missed notifications.
      yield* storage
        .publish(channel(sessionId), JSON.stringify({ ended: true }))
        .pipe(Effect.ignore);
    }),
  };
}

/** Execute at Promise boundaries; Effect callers keep the tagged storage failure. */
function runPreviewBuild<A>(
  effect: Effect.Effect<A, PreviewBuildError | PreviewStorageError>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.catchTag("PreviewStorageError", (error) => Effect.fail(error.cause))),
  );
}

/** Promise facade for oRPC and the existing lifecycle callers. */
export function createPreviewBuildStore(kv: KV) {
  const store = createPreviewBuildStoreEffects(kv);
  return {
    begin: (...args: Parameters<typeof store.begin>) => runPreviewBuild(store.begin(...args)),
    upload: (...args: Parameters<typeof store.upload>) => runPreviewBuild(store.upload(...args)),
    commit: (...args: Parameters<typeof store.commit>) => runPreviewBuild(store.commit(...args)),
    current: (...args: Parameters<typeof store.current>) => runPreviewBuild(store.current(...args)),
    chunk: (...args: Parameters<typeof store.chunk>) => runPreviewBuild(store.chunk(...args)),
    subscribe: (...args: Parameters<typeof store.subscribe>) =>
      runPreviewBuild(store.subscribe(...args)),
    end: (...args: Parameters<typeof store.end>) => runPreviewBuild(store.end(...args)),
  };
}
