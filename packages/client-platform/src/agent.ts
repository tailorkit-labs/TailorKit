import { z } from "zod";
import type { AgentChatResponse } from "./client/types.gen.js";

/** Public transport only; builder implementation stays in the licensed platform. */
export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("tool"), name: z.string(), callId: z.string() }),
  z.object({ type: z.literal("step") }),
  z.object({ type: z.literal("reset") }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]) satisfies z.ZodType<AgentEvent>;

export type AgentEvent = Extract<AgentChatResponse, { event: "message" }>["data"];
export const agentMessageSchema = z.string().trim().min(1).max(32_000);
