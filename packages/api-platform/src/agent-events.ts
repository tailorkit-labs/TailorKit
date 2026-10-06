import { z } from "zod";
import { asSchema, uiMessageChunkSchema, type UIMessageChunk } from "ai";

const chunkSchema = asSchema(uiMessageChunkSchema);

/** Use the SDK's validator so transport parts stay aligned with its protocol. */
export const agentChunkSchema = z
  .custom<UIMessageChunk>(async (value) => (await chunkSchema.validate?.(value))?.success === true)
  .describe("An AI SDK UIMessageChunk. Fields depend on the chunk type.");

export const agentMessageSchema = z.string().trim().min(1).max(32_000);
