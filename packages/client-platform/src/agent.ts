import { z } from "zod";
import { asSchema, uiMessageChunkSchema, type UIMessageChunk } from "ai";

const chunkSchema = asSchema(uiMessageChunkSchema);

/** Use the SDK's validator so transport parts stay aligned with its protocol. */
export const agentChunkSchema = z
  .custom<UIMessageChunk>(async (value) => (await chunkSchema.validate?.(value))?.success === true)
  .describe("An AI SDK UIMessageChunk. Fields depend on the chunk type.");

export type AgentChunk = UIMessageChunk;
/** Parts stay extensible; the platform validates their SDK shapes before running. */
export const agentMessagesSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      role: z.enum(["user", "assistant"]),
      parts: z.array(z.looseObject({ type: z.string() })).min(1),
      metadata: z.unknown().optional(),
    }),
  )
  .min(1);

export const agentChatSchema = z.object({
  appId: z.string().min(1),
  hostUrl: z.url({ protocol: /^https?$/u }),
  schema: z.record(z.string(), z.unknown()).optional(),
  messages: agentMessagesSchema,
});
