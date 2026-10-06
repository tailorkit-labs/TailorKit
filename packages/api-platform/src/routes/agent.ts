import { createHash } from "node:crypto";
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { openapi } from "@orpc/openapi";
import { eventIterator, ORPCError, streamToAsyncIteratorObject } from "@orpc/server";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { appAgent } from "@tailorkit/builder-agent";
import { db } from "@tailorkit/db";
import { Sandbox } from "@vercel/sandbox";
import { validateUIMessages, type UIMessageChunk } from "ai";
import { start } from "workflow/api";
import { z } from "zod";
import { env } from "#env";
import { agentChatSchema, agentChunkSchema } from "../agent-events";
import { o, protectedRouter } from "../procedures";
import { canonicalizeScope } from "../scope";

async function authenticateCli(projectId: string, deployToken: string, runtimeService?: boolean) {
  if (runtimeService) throw new ORPCError("FORBIDDEN");
  if (!env.AUTH_SECRET) throw new ORPCError("SERVICE_UNAVAILABLE");
  const token = await db.query.cliToken.findFirst({
    where: { projectId, tokenHash: hashSecret(deployToken, env.AUTH_SECRET) },
  });
  if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now()) {
    throw new ORPCError("UNAUTHORIZED", { message: "Invalid CLI deploy token." });
  }
  try {
    if (canonicalizeScope(token.scope).scopeKey !== token.scopeKey)
      throw new Error("Invalid scope");
  } catch {
    throw new ORPCError("UNAUTHORIZED", { message: "Invalid CLI token scope." });
  }
  return token;
}

const chat = protectedRouter
  .meta(openapi({ path: "/chat", method: "POST", outputStructure: "compact" }))
  .input(z.object({ body: agentChatSchema.extend({ deployToken: z.string().min(1) }) }))
  .output(eventIterator(agentChunkSchema))
  .handler(async ({ context, input, signal: requestSignal }) => {
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
    const timeout = AbortSignal.timeout(10 * 60 * 1000);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
    signal.throwIfAborted();
    const run = await start(appAgent, [
      {
        appId: `cli-${workspace}`,
        messages,
        model: env.BUILDER_AGENT_MODEL ?? "anthropic/claude-sonnet-5.5",
      },
    ]);
    const chunks = streamToAsyncIteratorObject(
      run.readable.pipeThrough(createModelCallToUIChunkTransform()),
      { signal },
    );
    // Sandbox setup can fail before opening the stream. Observe the run too.
    const result = run.returnValue;
    const failure = result.then(
      () => new Promise<never>(() => {}),
      (error: unknown) => Promise.reject(error),
    );
    return (async function* (): AsyncGenerator<UIMessageChunk> {
      let completed = false;
      try {
        for (;;) {
          const { done, value } = await Promise.race([chunks.next(), failure]);
          if (done) break;
          if (value.type === "error") throw new Error("Builder failed");
          if (value.type !== "finish") yield value;
        }
        // Let sandbox stop finish before the CLI starts its next turn.
        await result;
        signal.throwIfAborted();
        completed = true;
        yield { type: "finish" };
      } catch {
        if (!signal.aborted)
          yield { type: "error", errorText: "The builder agent failed. Start a new session." };
      } finally {
        await chunks.return?.().catch(() => {});
        if (!completed) {
          await run.cancel();
          try {
            const sandbox = await Sandbox.get({ name: `app-cli-${workspace}` });
            await sandbox.delete({ deleteOrphanSnapshots: true });
          } catch {
            // Setup may not have created a workspace; compute also has a timeout.
          }
        }
      }
    })();
  });

export const agentRouter = o.meta(openapi({ prefix: "/agent" })).router({ chat });
