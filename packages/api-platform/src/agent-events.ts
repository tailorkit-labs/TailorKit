import { z } from "zod";

/** Public transport only; builder implementation stays in the licensed platform. */
export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("tool"), name: z.string(), callId: z.string() }),
  z.object({ type: z.literal("step") }),
  z.object({ type: z.literal("reset") }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
export const agentMessageSchema = z.string().trim().min(1).max(32_000);
