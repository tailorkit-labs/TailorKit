import { createHash } from "node:crypto";
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { openapi } from "@orpc/openapi";
import { eventIterator, ORPCError, streamToAsyncIteratorObject } from "@orpc/server";
import { appAgent } from "@tailorkit/builder-agent";
import { createUIMessageStream, validateUIMessages } from "ai";
import { start } from "workflow/api";
import { z } from "zod";
import { env } from "#env";
import { agentChatSchema, agentChunkSchema } from "../agent-events";
import { o, protectedRouter } from "../procedures";
import { authenticateCli } from "../cli-token";

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
    let messages;
    try {
      messages = await validateUIMessages({ messages: input.body.messages });
    } catch {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid agent messages." });
    }
    // Client IDs select a workspace only within this authenticated project/token.
    const workspace = createHash("sha256")
      .update(JSON.stringify([context.project.id, token.id, input.body.sessionId]))
      .digest("hex")
      .slice(0, 32);
    const run = await start(appAgent, [
      {
        appId: `cli-${workspace}`,
        messages,
        model: env.BUILDER_AGENT_MODEL ?? "anthropic/claude-sonnet-5.5",
      },
    ]);
    return streamToAsyncIteratorObject(
      createUIMessageStream({
        execute: ({ writer }) => {
          writer.merge(run.readable.pipeThrough(createModelCallToUIChunkTransform()));
        },
      }),
      { signal },
    );
  });

export const agentRouter = o.meta(openapi({ prefix: "/agent" })).router({ chat });
