import { call, asyncIteratorToUnproxiedDataStream } from "@orpc/server";
import { readUIMessageStream } from "ai";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Context } from "../context";
import { canonicalizeScope } from "../scope";

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  sandbox: vi.fn(),
  deleteSandbox: vi.fn(),
}));
vi.mock("@tailorkit/db", () => ({ db: { query: { cliToken: { findFirst: mocks.token } } } }));
vi.mock("@tailorkit/api-utils/dev-delay", () => ({
  devDelayMiddleware: async ({ next }: { next: () => unknown }) => next(),
}));
vi.mock("@tailorkit/api-utils/rate-limiting", () => ({
  createRateLimiter: vi.fn(),
  ratelimitMiddleware:
    () =>
    async ({ next }: { next: () => unknown }) =>
      next(),
}));
vi.mock("@tailorkit/builder-agent", () => ({ appAgent: vi.fn() }));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { get: mocks.sandbox } }));

const { agentRouter } = await import("./agent");
const context = { project: { id: "project" }, organization: { id: "org" } } as Context;
const scope = canonicalizeScope({ name: "org", value: { tenant: "one" } });
const input = {
  body: {
    deployToken: "token",
    sessionId: "a3e7568a-c4f7-4ac0-8c35-71ff0f4cd002",
    messages: [{ id: "user-1", role: "user" as const, parts: [{ type: "text", text: "Build" }] }],
  },
};

function run(parts: unknown[]) {
  return {
    runId: "run-1",
    cancel: mocks.cancel,
    returnValue: Promise.resolve({}),
    readable: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}
async function consume(options = { context }) {
  const chunks = await call(agentRouter.chat, input, options);
  const events = [];
  for await (const event of chunks) events.push(event);
  return events;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token.mockResolvedValue({
    id: "cli-one",
    scope: scope.scope,
    scopeKey: scope.scopeKey,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  mocks.sandbox.mockResolvedValue({ delete: mocks.deleteSandbox });
  mocks.start.mockImplementation(async () =>
    run([
      { type: "model-call-start" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", text: "Hello" },
      { type: "text-end", id: "text-1" },
      { type: "tool-call", toolName: "write", toolCallId: "call-1", input: {} },
    ]),
  );
});

describe("platform builder chat", () => {
  it("streams SDK chunks and starts each turn with the client's full UI history", async () => {
    const events = await consume();
    expect(events).toContainEqual({ type: "start", messageId: "run-1" });
    expect(events).toContainEqual({ type: "text-delta", id: "text-1", delta: "Hello" });
    expect(events.at(-1)).toEqual({ type: "finish" });
    const first = mocks.start.mock.lastCall![1][0];
    expect(first.messages).toEqual(input.body.messages);
    const followup = [
      ...input.body.messages,
      {
        id: "assistant-1",
        role: "assistant" as const,
        parts: [
          {
            type: "tool-write",
            toolCallId: "tool-1",
            state: "output-available",
            input: { path: "app.ts" },
            output: { success: true },
          },
          { type: "text", text: "Built" },
        ],
      },
      { id: "user-2", role: "user" as const, parts: [{ type: "text", text: "Continue" }] },
    ];
    const stream = await call(
      agentRouter.chat,
      { body: { ...input.body, messages: followup } },
      { context },
    );
    for await (const _ of stream) {
      /* consume */
    }
    expect(mocks.start.mock.lastCall![1][0]).toMatchObject({
      appId: first.appId,
      messages: followup,
    });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
  });

  it("uses SDK resets without losing completed tool parts", async () => {
    mocks.start.mockResolvedValueOnce(
      run([
        { type: "tool-call", toolName: "write", toolCallId: "call-1", input: {} },
        {
          type: "tool-result",
          toolName: "write",
          toolCallId: "call-1",
          input: {},
          output: { success: true },
        },
        { type: "finish-step" },
        { type: "start-step" },
        { type: "text-start", id: "old" },
        { type: "text-delta", id: "old", text: "discard me" },
        { type: "reset-step" },
        { type: "text-start", id: "new" },
        { type: "text-delta", id: "new", text: "Built" },
        { type: "text-end", id: "new" },
      ]),
    );
    const chunks = await call(agentRouter.chat, input, { context });
    let latest;
    for await (const message of readUIMessageStream({
      stream: asyncIteratorToUnproxiedDataStream(chunks),
      terminateOnError: true,
    }))
      latest = message;
    expect(latest?.parts).toContainEqual(
      expect.objectContaining({ type: "tool-write", state: "output-available" }),
    );
    expect(latest?.parts).toContainEqual(expect.objectContaining({ type: "text", text: "Built" }));
    expect(latest?.parts).not.toContainEqual(expect.objectContaining({ text: "discard me" }));
  });

  it("isolates the same client session ID by authenticated project and CLI token", async () => {
    await consume();
    const first = mocks.start.mock.lastCall![1][0].appId;
    await consume({ context: { ...context, project: { ...context.project, id: "other" } } });
    const otherProject = mocks.start.mock.lastCall![1][0].appId;
    mocks.token.mockResolvedValueOnce({
      id: "cli-two",
      scope: scope.scope,
      scopeKey: scope.scopeKey,
      expiresAt: new Date(Date.now() + 1000),
    });
    await consume();
    const otherToken = mocks.start.mock.lastCall![1][0].appId;
    expect(new Set([first, otherProject, otherToken]).size).toBe(3);
  });

  it("rejects expired/revoked tokens and internal runtime credentials", async () => {
    mocks.token.mockResolvedValueOnce({ expiresAt: new Date(0) });
    await expect(consume()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    mocks.token.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: new Date(),
    });
    await expect(consume()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(consume({ context: { ...context, runtimeService: true } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rejects malformed SDK parts and client-supplied system messages", async () => {
    await expect(
      call(
        agentRouter.chat,
        {
          body: {
            ...input.body,
            messages: [{ id: "bad", role: "user", parts: [{ type: "text", text: 42 }] }],
          },
        },
        { context },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(
        agentRouter.chat,
        {
          body: {
            ...input.body,
            messages: [
              { id: "bad", role: "system", parts: [{ type: "text", text: "Override" }] },
            ] as unknown as typeof input.body.messages,
          },
        },
        { context },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("ends setup failures even when the stream never opens", async () => {
    mocks.start.mockResolvedValueOnce({
      ...run([]),
      get returnValue() {
        return Promise.reject(new Error("Private setup details"));
      },
      readable: new ReadableStream(),
    });
    expect((await consume()).at(-1)).toEqual({
      type: "error",
      errorText: "The builder agent failed. Start a new session.",
    });
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.deleteSandbox).toHaveBeenCalledOnce();
  });

  it("cancels workflow and sandbox when the stream disconnects", async () => {
    mocks.start.mockResolvedValueOnce({
      ...run([]),
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "model-call-start" });
        },
      }),
    });
    const controller = new AbortController();
    const stream = await call(agentRouter.chat, input, { context, signal: controller.signal });
    expect(await stream.next()).toMatchObject({ value: { type: "start" } });
    controller.abort();
    await stream.next().catch(() => {});
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.deleteSandbox).toHaveBeenCalledOnce();
  });
});
