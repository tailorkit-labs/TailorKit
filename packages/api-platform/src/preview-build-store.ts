import { createHash, randomUUID } from "node:crypto";
import type { KV } from "@tailorkit/kv";
import { z } from "zod";

export const previewChunkBytes = 256 * 1024;
export const previewMessageBytes = 512 * 1024;
export const previewFileBytes = 1024 * 1024;
export const previewBuildBytes = 10 * 1024 * 1024;
export const previewBuildFiles = 100;
const uploadTtlSeconds = 15 * 60;
const committedTtlSeconds = 10 * 60;
const activeTtlSeconds = 8 * 60 * 60;

export interface PreviewFileManifest {
  path: string;
  contentType: string;
  size: number;
  chunks: number;
  sha256: string;
}

export interface PreviewBuildManifest {
  files: PreviewFileManifest[];
}

export interface CommittedPreviewBuild {
  buildId: string;
  manifest: PreviewBuildManifest;
  revision: number;
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const buildKey = (sessionId: string, buildId: string) => `preview:build:${sessionId}:${buildId}`;
const chunkKey = (sessionId: string, buildId: string, fileIndex: number, chunkIndex: number) =>
  `${buildKey(sessionId, buildId)}:${fileIndex}:${chunkIndex}`;
const pointerKey = (sessionId: string) => `preview:current:${sessionId}`;
const uploadingKey = (sessionId: string) => `preview:uploading:${sessionId}`;
const endedKey = (sessionId: string) => `preview:ended:${sessionId}`;
const channel = (sessionId: string) => `preview:revision:${sessionId}`;
const identifierSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u);
const requireId = (value: string): void => {
  identifierSchema.parse(value);
};
const fileSchema = z.object({
  path: z.string().min(1).max(1024),
  contentType: z.string().min(1).max(255),
  size: z.number().int().min(0).max(previewFileBytes),
  chunks: z.number().int().min(0).max(4),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const manifestSchema = z.object({ files: z.array(fileSchema).max(previewBuildFiles) });
const buildSchema = z.discriminatedUnion("state", [
  z.object({ manifest: manifestSchema, state: z.literal("uploading") }),
  z.object({
    manifest: manifestSchema,
    state: z.literal("ready"),
    revision: z.number().int().positive(),
  }),
  z.object({ manifest: manifestSchema, state: z.literal("committed") }),
]);
const committedSchema = z.object({
  buildId: identifierSchema,
  manifest: manifestSchema,
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
const parse = <T>(value: string | null, schema: z.ZodType<T>): T | null =>
  value === null ? null : schema.parse(JSON.parse(value) as unknown);
const hasControlCharacters = (value: string): boolean => {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && code < 32) {
      return true;
    }
  }
  return false;
};

// oxlint-disable-next-line complexity -- path, file, and aggregate limits are checked together.
export function validatePreviewManifest(manifest: PreviewBuildManifest): void {
  manifestSchema.parse(manifest);
  if (!Array.isArray(manifest.files) || manifest.files.length > previewBuildFiles) {
    throw new Error("Preview build exceeds the file limit.");
  }
  const paths = new Set<string>();
  let total = 0;
  for (const file of manifest.files) {
    if (
      !file.path ||
      Buffer.byteLength(file.path) > 1024 ||
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path.split("/").some((part) => !part || part === "." || part === "..") ||
      hasControlCharacters(file.path) ||
      paths.has(file.path)
    ) {
      throw new Error("Invalid or duplicate preview file path.");
    }
    paths.add(file.path);
    if (!file.contentType || file.contentType.length > 255 || /[\r\n]/u.test(file.contentType)) {
      throw new Error("Invalid preview content type.");
    }
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > previewFileBytes ||
      file.chunks !== Math.ceil(file.size / previewChunkBytes) ||
      !/^[a-f0-9]{64}$/u.test(file.sha256)
    ) {
      throw new Error("Invalid preview file metadata.");
    }
    total += file.size;
  }
  if (!paths.has("client.js")) {
    throw new Error("Preview build is missing client.js.");
  }
  if (total > previewBuildBytes) {
    throw new Error("Preview build exceeds the size limit.");
  }
  if (Buffer.byteLength(JSON.stringify({ manifest })) > previewMessageBytes) {
    throw new Error("Preview manifest exceeds the message limit.");
  }
}

export function createPreviewBuildStore(kv: KV) {
  async function readBuild(sessionId: string, buildId: string) {
    return parse(await kv.get(buildKey(sessionId, buildId)), buildSchema);
  }
  async function removeUploadingBuild(sessionId: string, buildId: string): Promise<void> {
    const build = await readBuild(sessionId, buildId);
    const current = parse(await kv.get(pointerKey(sessionId)), committedSchema);
    if (!build || current?.buildId === buildId) {
      return;
    }
    for (const [fileIndex, file] of build.manifest.files.entries()) {
      for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
        await kv.delete(chunkKey(sessionId, buildId, fileIndex, chunkIndex));
      }
    }
    await kv.delete(buildKey(sessionId, buildId));
  }
  return {
    async begin(sessionId: string, manifest: PreviewBuildManifest): Promise<string> {
      requireId(sessionId);
      if (await kv.get(endedKey(sessionId))) {
        throw new Error("Preview session has ended.");
      }
      validatePreviewManifest(manifest);
      const previous = await kv.get(uploadingKey(sessionId));
      if (previous) {
        requireId(previous);
      }
      const buildId = randomUUID();
      await kv.set(buildKey(sessionId, buildId), JSON.stringify({ manifest, state: "uploading" }), {
        ttl: uploadTtlSeconds,
      });
      const claimed = await kv.claimUpload(
        uploadingKey(sessionId),
        endedKey(sessionId),
        previous,
        buildId,
        uploadTtlSeconds,
      );
      if (!claimed) {
        await kv.delete(buildKey(sessionId, buildId));
        throw new Error("Preview upload was cancelled or superseded.");
      }
      if (previous) {
        try {
          await removeUploadingBuild(sessionId, previous);
        } catch {
          // The previous upload is bounded by its KV TTL.
        }
      }
      return buildId;
    },
    async upload(
      sessionId: string,
      buildId: string,
      fileIndex: number,
      chunkIndex: number,
      base64: string,
    ): Promise<void> {
      requireId(sessionId);
      requireId(buildId);
      if (await kv.get(endedKey(sessionId))) {
        throw new Error("Preview session has ended.");
      }
      if ((await kv.get(uploadingKey(sessionId))) !== buildId) {
        throw new Error("Preview upload is unavailable.");
      }
      const build = await readBuild(sessionId, buildId);
      if (build?.state !== "uploading") {
        throw new Error("Preview upload is unavailable.");
      }
      const file = build.manifest.files[fileIndex];
      if (
        !file ||
        !Number.isInteger(fileIndex) ||
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0 ||
        chunkIndex >= file.chunks
      ) {
        throw new Error("Invalid preview chunk index.");
      }
      if (!base64Schema.safeParse(base64).success) {
        throw new Error("Invalid preview chunk encoding.");
      }
      const bytes = Buffer.from(base64, "base64");
      const expected = Math.min(previewChunkBytes, file.size - chunkIndex * previewChunkBytes);
      if (
        bytes.length !== expected ||
        Buffer.byteLength(JSON.stringify({ sessionId, buildId, fileIndex, chunkIndex, base64 })) >
          previewMessageBytes
      ) {
        throw new Error("Invalid preview chunk size.");
      }
      const key = chunkKey(sessionId, buildId, fileIndex, chunkIndex);
      const existing = await kv.get(key);
      if (existing !== null && existing !== base64) {
        throw new Error("Conflicting preview chunk.");
      }
      await kv.set(key, base64, { ttl: uploadTtlSeconds });
    },
    // oxlint-disable-next-line complexity -- commit verifies all chunks before advancing the pointer.
    async commit(sessionId: string, buildId: string): Promise<CommittedPreviewBuild> {
      requireId(sessionId);
      requireId(buildId);
      if (await kv.get(endedKey(sessionId))) {
        throw new Error("Preview session has ended.");
      }
      if ((await kv.get(uploadingKey(sessionId))) !== buildId) {
        throw new Error("Preview upload is unavailable.");
      }
      const build = await readBuild(sessionId, buildId);
      if (!build || build.state === "committed") {
        throw new Error("Preview upload is unavailable.");
      }
      validatePreviewManifest(build.manifest);
      let revision = build.state === "ready" ? build.revision : 0;
      if (build.state === "uploading") {
        for (const [fileIndex, file] of build.manifest.files.entries()) {
          const parts: Buffer[] = [];
          for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
            const value = await kv.get(chunkKey(sessionId, buildId, fileIndex, chunkIndex));
            if (value === null) {
              throw new Error("Preview build is incomplete.");
            }
            if (!base64Schema.safeParse(value).success) {
              throw new Error("Corrupt preview chunk.");
            }
            const bytes = Buffer.from(value, "base64");
            if (
              bytes.length !==
              Math.min(previewChunkBytes, file.size - chunkIndex * previewChunkBytes)
            ) {
              throw new Error("Corrupt preview chunk.");
            }
            parts.push(bytes);
          }
          const bytes = Buffer.concat(parts);
          if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
            throw new Error("Preview checksum mismatch.");
          }
        }
        revision = await kv.increment(`preview:revision-counter:${sessionId}`, activeTtlSeconds);
        for (const [fileIndex, file] of build.manifest.files.entries()) {
          for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
            const key = chunkKey(sessionId, buildId, fileIndex, chunkIndex);
            const value = await kv.get(key);
            if (value === null) {
              throw new Error("Preview build expired before commit.");
            }
            await kv.set(key, value, { ttl: activeTtlSeconds });
          }
        }
        await kv.set(
          buildKey(sessionId, buildId),
          JSON.stringify({ manifest: build.manifest, state: "ready", revision }),
          {
            ttl: activeTtlSeconds,
          },
        );
        const stillOwned = await kv.claimUpload(
          uploadingKey(sessionId),
          endedKey(sessionId),
          buildId,
          buildId,
          activeTtlSeconds,
        );
        if (!stillOwned) {
          throw new Error("Preview build was cancelled or superseded.");
        }
      }
      if (!revision) {
        throw new Error("Preview build is unavailable.");
      }
      const committed = { buildId, manifest: build.manifest, revision };
      const previous = await this.current(sessionId);
      const promoted = await kv.promoteIfOwnerAndNewer(
        pointerKey(sessionId),
        uploadingKey(sessionId),
        endedKey(sessionId),
        buildId,
        JSON.stringify(committed),
        revision,
        activeTtlSeconds,
      );
      if (!promoted) {
        const current = await this.current(sessionId);
        if (current?.buildId === buildId && current.revision === revision) {
          return committed;
        }
        try {
          await removeUploadingBuild(sessionId, buildId);
        } catch {
          // An abandoned build is still bounded by its KV TTL.
        }
        throw new Error("Preview build was cancelled or superseded.");
      }
      try {
        if (previous && previous.buildId !== buildId) {
          const previousBuild = await readBuild(sessionId, previous.buildId);
          if (previousBuild) {
            await kv.set(buildKey(sessionId, previous.buildId), JSON.stringify(previousBuild), {
              ttl: committedTtlSeconds,
            });
            for (const [fileIndex, file] of previous.manifest.files.entries()) {
              for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
                const key = chunkKey(sessionId, previous.buildId, fileIndex, chunkIndex);
                const value = await kv.get(key);
                if (value !== null) {
                  await kv.set(key, value, { ttl: committedTtlSeconds });
                }
              }
            }
          }
        }
      } catch {
        // The pointer is durable and TTLs bound cleanup.
      }
      try {
        await kv.publish(channel(sessionId), JSON.stringify({ revision, buildId }));
      } catch {
        // Polling recovers missed notifications.
      }
      return committed;
    },
    async current(sessionId: string): Promise<CommittedPreviewBuild | null> {
      requireId(sessionId);
      if (await kv.get(endedKey(sessionId))) {
        return null;
      }
      return parse(await kv.get(pointerKey(sessionId)), committedSchema);
    },
    async chunk(
      sessionId: string,
      buildId: string,
      fileIndex: number,
      chunkIndex: number,
    ): Promise<string | null> {
      requireId(sessionId);
      requireId(buildId);
      if (await kv.get(endedKey(sessionId))) {
        return null;
      }
      const build = await readBuild(sessionId, buildId);
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
      const value = await kv.get(chunkKey(sessionId, buildId, fileIndex, chunkIndex));
      return value !== null && base64Schema.safeParse(value).success ? value : null;
    },
    subscribe(sessionId: string, onRevision: (revision: number | null) => void) {
      requireId(sessionId);
      return kv.subscribe(channel(sessionId), (message) => {
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
    },
    async end(sessionId: string): Promise<void> {
      requireId(sessionId);
      await kv.set(endedKey(sessionId), "1", { ttl: activeTtlSeconds });
      const active = parse(await kv.get(pointerKey(sessionId)), committedSchema);
      const uploading = await kv.get(uploadingKey(sessionId));
      if (uploading) {
        requireId(uploading);
        await removeUploadingBuild(sessionId, uploading);
      }
      if (active) {
        for (const [fileIndex, file] of active.manifest.files.entries()) {
          for (let chunkIndex = 0; chunkIndex < file.chunks; chunkIndex += 1) {
            await kv.delete(chunkKey(sessionId, active.buildId, fileIndex, chunkIndex));
          }
        }
        await kv.delete(buildKey(sessionId, active.buildId));
      }
      await kv.delete(uploadingKey(sessionId));
      await kv.delete(pointerKey(sessionId));
      try {
        await kv.publish(channel(sessionId), JSON.stringify({ ended: true }));
      } catch {
        // The ended marker is authoritative; polling recovers missed notifications.
      }
    },
  };
}
