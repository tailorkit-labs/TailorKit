import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import { z } from "zod";

/** Stable error discriminator for an app that already has an active preview. */
export const ACTIVE_PREVIEW_CONFLICT_REASON = "ACTIVE_PREVIEW_EXISTS" as const;

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const base64 = z
  .string()
  .max(4 * Math.ceil((256 * 1024) / 3))
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const hasControlCharacters = (value: string) =>
  [...value].some((character) => (character.codePointAt(0) ?? 0) < 32);

export const previewFileManifestSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(1024)
    .refine((path) => new TextEncoder().encode(path).byteLength <= 1024, {
      message: "Preview path exceeds 1024 UTF-8 bytes",
    }),
  contentType: z
    .string()
    .min(1)
    .max(255)
    .refine((contentType) => !/[\r\n]/u.test(contentType), {
      message: "Invalid preview content type",
    }),
  size: z
    .number()
    .int()
    .min(0)
    .max(1024 * 1024),
  chunks: z.number().int().min(0).max(4),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const previewBuildManifestSchema = z
  .object({
    files: z.array(previewFileManifestSchema).max(100),
    views: z
      .array(
        z.object({
          slot: z.string().min(1).max(255),
          path: z.string().startsWith("/").max(1024),
          instances: z.literal(true).optional(),
          disabled: z.literal(true).optional(),
        }),
      )
      .max(1000)
      .optional(),
  })
  .superRefine((manifest, context) => {
    const paths = new Set<string>();
    let total = 0;
    for (const [index, file] of manifest.files.entries()) {
      if (
        file.path.startsWith("/") ||
        file.path.includes("\\") ||
        file.path.split("/").some((part) => !part || part === "." || part === "..") ||
        hasControlCharacters(file.path) ||
        paths.has(file.path)
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid or duplicate preview path",
          path: ["files", index, "path"],
        });
      }
      if (file.chunks !== Math.ceil(file.size / (256 * 1024))) {
        context.addIssue({
          code: "custom",
          message: "Invalid preview chunk count",
          path: ["files", index, "chunks"],
        });
      }
      paths.add(file.path);
      total += file.size;
    }
    if (!paths.has("client.js")) context.addIssue({ code: "custom", message: "Missing client.js" });
    if (total > 10 * 1024 * 1024)
      context.addIssue({ code: "custom", message: "Preview build exceeds 10 MiB" });
  });
export const previewEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("begin"),
    buildId: identifier,
    revision: z.number().int().positive(),
    manifest: previewBuildManifestSchema,
  }),
  z.object({
    type: z.literal("chunk"),
    revision: z.number().int().positive(),
    fileIndex: z.number().int().min(0).max(99),
    chunkIndex: z.number().int().min(0).max(3),
    base64,
  }),
  z.object({ type: z.literal("complete"), revision: z.number().int().positive() }),
  z.object({ type: z.literal("ended") }),
]);
export const previewMetadataSchema = z.object({
  sessionId: z.uuid(),
  expiresAt: z.string().min(1),
  websocketUrl: z.url(),
  token: z.string().min(1),
});

export type PreviewFileManifest = z.infer<typeof previewFileManifestSchema>;
export type PreviewBuildManifest = z.infer<typeof previewBuildManifestSchema>;
export type PreviewEvent = z.infer<typeof previewEventSchema>;

const beginInput = z.object({ manifest: previewBuildManifestSchema });
const uploadInput = z.object({
  buildId: identifier,
  fileIndex: z.number().int().min(0).max(99),
  chunkIndex: z.number().int().min(0).max(3),
  base64,
});
const buildIdOutput = z.object({ buildId: identifier });
const acceptedOutput = z.object({ accepted: z.literal(true) });
const commitOutput = z.object({ revision: z.number().int().positive() });

export interface PreviewWebSocketClient {
  beginBuild(input: z.input<typeof beginInput>): Promise<z.infer<typeof buildIdOutput>>;
  uploadChunk(input: z.input<typeof uploadInput>): Promise<z.infer<typeof acceptedOutput>>;
  commitBuild(input: { buildId: string }): Promise<z.infer<typeof commitOutput>>;
  heartbeat(): Promise<z.infer<typeof acceptedOutput>>;
  subscribe(): Promise<AsyncIterable<PreviewEvent>>;
}

/** Validates every preview WebSocket request, response, and streamed event. */
export function createPreviewWebSocketClient(websocket: WebSocket): PreviewWebSocketClient {
  const rpc = createORPCClient(
    new RPCLink({ connect: () => websocket }),
  ) as unknown as PreviewWebSocketClient;
  return {
    beginBuild: async (input) => buildIdOutput.parse(await rpc.beginBuild(beginInput.parse(input))),
    uploadChunk: async (input) =>
      acceptedOutput.parse(await rpc.uploadChunk(uploadInput.parse(input))),
    commitBuild: async (input) =>
      commitOutput.parse(await rpc.commitBuild({ buildId: identifier.parse(input.buildId) })),
    heartbeat: async () => acceptedOutput.parse(await rpc.heartbeat()),
    subscribe: async () => {
      const stream = await rpc.subscribe();
      return (async function* () {
        for await (const value of stream) {
          yield previewEventSchema.parse(value);
        }
      })();
    },
  };
}
