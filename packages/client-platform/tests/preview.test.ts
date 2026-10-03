import { describe, expect, it } from "vite-plus/test";
import {
  previewBuildManifestSchema,
  previewEventSchema,
  previewFileManifestSchema,
  previewMetadataSchema,
} from "../src/preview";

describe("preview message schemas", () => {
  const manifest = {
    files: [
      {
        path: "client.js",
        contentType: "text/javascript",
        size: 1,
        chunks: 1,
        sha256: "a".repeat(64),
      },
    ],
  };

  it("accepts a valid build event", () => {
    expect(
      previewEventSchema.parse({ type: "begin", buildId: "build", revision: 1, manifest }),
    ).toMatchObject({ type: "begin" });
  });

  it("rejects malformed and oversized stream messages", () => {
    expect(
      previewEventSchema.safeParse({
        type: "chunk",
        revision: 1,
        fileIndex: 0,
        chunkIndex: 0,
        base64: "***",
      }).success,
    ).toBe(false);
    expect(
      previewEventSchema.safeParse({
        type: "chunk",
        revision: 1,
        fileIndex: 0,
        chunkIndex: 0,
        base64: "A".repeat(350_000),
      }).success,
    ).toBe(false);
    expect(previewEventSchema.safeParse({ type: "complete", revision: -1 }).success).toBe(false);
    expect(previewEventSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });

  it("rejects invalid manifest and metadata values", () => {
    expect(
      previewBuildManifestSchema.safeParse({ files: [{ ...manifest.files[0], size: -1 }] }).success,
    ).toBe(false);
    expect(
      previewMetadataSchema.safeParse({
        sessionId: "bad",
        expiresAt: "later",
        websocketUrl: "bad",
        token: "token",
      }).success,
    ).toBe(false);
  });
});

describe("preview file manifest", () => {
  const file = (path: string, contentType = "text/javascript") => ({
    path,
    contentType,
    size: 0,
    chunks: 0,
    sha256: "0".repeat(64),
  });

  it("enforces the path limit in UTF-8 bytes", () => {
    expect(previewFileManifestSchema.safeParse(file("é".repeat(512))).success).toBe(true);
    expect(previewFileManifestSchema.safeParse(file("é".repeat(513))).success).toBe(false);
  });

  it("rejects CR and LF in content types", () => {
    expect(previewFileManifestSchema.safeParse(file("client.js", "text/javascript")).success).toBe(
      true,
    );
    expect(
      previewFileManifestSchema.safeParse(file("client.js", "text/javascript\rbad")).success,
    ).toBe(false);
    expect(
      previewFileManifestSchema.safeParse(file("client.js", "text/javascript\nbad")).success,
    ).toBe(false);
  });
});
