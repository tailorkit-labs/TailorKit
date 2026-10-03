import { z } from "zod";
import {
  previewBuildBytes,
  previewBuildFiles,
  previewChunkBytes,
  previewFileBytes,
  previewMessageBytes,
} from "./constants";

export const previewIdentifierSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u);
export const previewFileSchema = z.object({
  path: z.string().min(1).max(1024),
  contentType: z.string().min(1).max(255),
  size: z.number().int().min(0).max(previewFileBytes),
  chunks: z
    .number()
    .int()
    .min(0)
    .max(Math.ceil(previewFileBytes / previewChunkBytes)),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const previewManifestSchema = z.object({
  files: z.array(previewFileSchema).max(previewBuildFiles),
});

export type PreviewFileManifest = z.infer<typeof previewFileSchema>;
export type PreviewBuildManifest = z.infer<typeof previewManifestSchema>;

export interface CommittedPreviewBuild {
  buildId: string;
  manifest: PreviewBuildManifest;
  revision: number;
}

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
  previewManifestSchema.parse(manifest);
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
