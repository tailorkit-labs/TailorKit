import { randomUUID } from "node:crypto";
import { openapi } from "@orpc/openapi";
import { eventIterator, ORPCError } from "@orpc/server";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { appAgent } from "@tailorkit/builder-agent";
import { agentEventSchema, agentMessageSchema, type AgentEvent } from "../agent-events";
import { db } from "@tailorkit/db";
import { Sandbox } from "@vercel/sandbox";
import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { getRun, start, type Run } from "workflow/api";
import { z } from "zod";
import { env } from "#env";
import { agentSessionStore, type AgentSession } from "../agent-sessions";
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

async function disposeSession(sessionId: string, session: AgentSession) {
  await agentSessionStore().end(sessionId);
  if (!session.runId) return;
  const run = getRun(session.runId);
  const status = await run.status;
  if (status === "running" || status === "pending") await run.cancel();
  // The workspace is unique to this conversation, never a deployed app.
  try {
    const sandbox = await Sandbox.get({ name: `app-cli-${sessionId}` });
    await sandbox.delete({ deleteOrphanSnapshots: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response instanceof Response &&
      error.response.status === 404
    )
      return;
    throw error;
  }
}

// WorkflowAgent also writes lifecycle chunks that its model-part type omits.
type AgentStreamPart = ModelCallStreamPart | { type: "start-step" | "finish-step" | "finish" };

export function toAgentEvent(part: AgentStreamPart): AgentEvent | undefined {
  switch (part.type) {
    case "text-delta":
      return { type: "text", delta: part.text };
    case "tool-call":
      return { type: "tool", name: part.toolName, callId: part.toolCallId };
    case "model-call-start":
    case "finish-step":
      return { type: "step" };
    case "reset-step":
      return { type: "reset" };
    case "error":
      return { type: "error", message: "The builder agent failed. Start a new session." };
    default:
      return undefined;
  }
}

const credentials = z.object({ deployToken: z.string().min(1) });
const sessionParams = z.object({ sessionId: z.uuid() });

const startSession = protectedRouter
  .meta(openapi({ path: "/start", method: "POST" }))
  .input(z.object({ body: credentials }))
  .output(z.object({ body: z.object({ sessionId: z.uuid(), expiresAt: z.string() }) }))
  .handler(async ({ context, input }) => {
    const token = await authenticateCli(
      context.project.id,
      input.body.deployToken,
      context.runtimeService,
    );
    return { body: await agentSessionStore().create(context.project.id, token.id) };
  });

const chat = protectedRouter
  .meta(openapi({ path: "/{sessionId}/chat", method: "POST", outputStructure: "compact" }))
  .input(
    z.object({ params: sessionParams, body: credentials.extend({ message: agentMessageSchema }) }),
  )
  .output(eventIterator(agentEventSchema))
  .handler(async ({ context, input, signal: requestSignal }) => {
    const token = await authenticateCli(
      context.project.id,
      input.body.deployToken,
      context.runtimeService,
    );
    const store = agentSessionStore();
    const { sessionId } = input.params;
    const session = await store.get(sessionId, context.project.id, token.id);
    const timeout = AbortSignal.timeout(Math.max(1, session.expiresAt - Date.now()));
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
    await store.claim(sessionId, randomUUID());
    let run: Run<Awaited<ReturnType<typeof appAgent>>>;
    try {
      const previous = session.runId
        ? await getRun<Awaited<ReturnType<typeof appAgent>>>(session.runId).returnValue
        : undefined;
      signal?.throwIfAborted();
      run = await start<[Parameters<typeof appAgent>[0]], Awaited<ReturnType<typeof appAgent>>>(
        appAgent,
        [
          {
            appId: `cli-${sessionId}`,
            messages: [
              ...(previous?.messages ?? []),
              { role: "user", content: input.body.message },
            ],
            sandboxId: previous?.sandboxId,
            model: env.BUILDER_AGENT_MODEL ?? "anthropic/claude-sonnet-5.5",
          },
        ],
      );
      session.runId = run.runId;
      if (!(await store.save(sessionId, session))) {
        await disposeSession(sessionId, session);
        throw new ORPCError("NOT_FOUND", { message: "Agent session was closed." });
      }
    } catch (error) {
      await store.release(sessionId);
      throw error;
    }

    return (async function* (): AsyncGenerator<AgentEvent> {
      let completed = false;
      const reader = run.getReadable<AgentStreamPart>().getReader();
      // A failed setup step never opens/closes the model stream. Observe the
      // workflow result too so that a failure cannot leave the chat hanging.
      const result = run.returnValue;
      const failure = result.then(
        () => new Promise<never>(() => {}),
        (error: unknown) => Promise.reject(error),
      );
      const abort = () => {
        void reader.cancel().catch(() => {});
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      try {
        for (;;) {
          const { done, value } = await Promise.race([reader.read(), failure]);
          if (done) break;
          const event = toAgentEvent(value);
          if (event?.type === "error") throw new Error(event.message);
          if (event) yield event;
        }
        signal?.throwIfAborted();
        await result;
        completed = true;
        yield { type: "done" };
      } catch {
        if (!signal?.aborted)
          yield { type: "error", message: "The builder agent failed. Start a new session." };
      } finally {
        signal?.removeEventListener("abort", abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        if (!completed) await disposeSession(sessionId, session);
        await store.release(sessionId);
      }
    })();
  });

const close = protectedRouter
  .meta(openapi({ path: "/{sessionId}/close", method: "POST" }))
  .input(z.object({ params: sessionParams, body: credentials }))
  .output(z.object({ body: z.object({}) }))
  .handler(async ({ context, input }) => {
    const token = await authenticateCli(
      context.project.id,
      input.body.deployToken,
      context.runtimeService,
    );
    const session = await agentSessionStore().get(
      input.params.sessionId,
      context.project.id,
      token.id,
    );
    await disposeSession(input.params.sessionId, session);
    return { body: {} };
  });

export const agentRouter = o
  .meta(openapi({ prefix: "/agent" }))
  .router({ start: startSession, chat, close });
