import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { openapi } from "@orpc/openapi";
import { eventIterator, ORPCError, streamToAsyncIteratorObject } from "@orpc/server";
import { appAgent } from "@tailorkit/app-agent/workflows";
import {
  asSchema,
  convertToModelMessages,
  createUIMessageStream,
  uiMessageChunkSchema,
  validateUIMessages,
  type UIMessageChunk,
} from "ai";
import { start } from "workflow/api";
import { z } from "zod";
import { findAppInScopes, o, protectedRouter } from "../procedures";
import { authenticateCli } from "../cli-token";
import { canonicalizeScope } from "../scope";

const APP_AGENT_MODEL = "openai/gpt-6.1-sol";

const chunkSchema = asSchema(uiMessageChunkSchema);

/** Use the SDK's validator so transport parts stay aligned with its protocol. */
const agentChunkSchema = z
  .custom<UIMessageChunk>(async (value) => (await chunkSchema.validate?.(value))?.success === true)
  .describe("An AI SDK UIMessageChunk. Fields depend on the chunk type.");

/** Parts stay extensible; the platform validates their SDK shapes before running. */
const agentMessagesSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      role: z.enum(["user", "assistant"]),
      parts: z.array(z.looseObject({ type: z.string() })).min(1),
      metadata: z.unknown().optional(),
    }),
  )
  .min(1);

const agentChatSchema = z.object({
  appId: z.string().min(1),
  hostUrl: z.url({ protocol: /^https?$/u }),
  schema: z.record(z.string(), z.unknown()).optional(),
  messages: agentMessagesSchema,
});

const chat = protectedRouter
  .meta(openapi({ path: "/chat", method: "POST", outputStructure: "compact" }))
  .input(z.object({ body: agentChatSchema.extend({ deployToken: z.string().min(1) }) }))
  .output(eventIterator(agentChunkSchema))
  .handler(async ({ context, input, signal }) => {
    const token = await authenticateCli(
      context.project.id,
      input.body.deployToken,
      context.runtimeService,
    );
    const app = await findAppInScopes(context.project.id, input.body.appId, [
      canonicalizeScope(token.scope),
    ]);
    let messages;
    try {
      messages = await convertToModelMessages(
        await validateUIMessages({ messages: input.body.messages }),
      );
    } catch {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid agent messages." });
    }
    const run = await start(appAgent, [
      {
        appId: app.id,
        hostUrl: input.body.hostUrl,
        schema: input.body.schema,
        messages,
        model: APP_AGENT_MODEL,
      },
    ]);
    return streamToAsyncIteratorObject(
      createUIMessageStream({
        execute: async ({ writer }) => {
          const controller = new AbortController();
          writer.merge(
            run.readable.pipeThrough(createModelCallToUIChunkTransform(), {
              signal: controller.signal,
            }),
          );
          try {
            // Finish the response only after cleanup releases the app's Drive.
            await run.returnValue;
          } catch (error) {
            // A busy Drive can fail before the workflow opens its model stream.
            controller.abort(error);
            throw error;
          }
        },
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      }),
      { signal },
    );
  });

export const appAgentRouter = o.meta(openapi({ prefix: "/app-agent" })).router({ chat });
