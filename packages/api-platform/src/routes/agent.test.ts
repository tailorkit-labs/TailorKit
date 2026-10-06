import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Context } from "../context";
import { canonicalizeScope } from "../scope";

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  start: vi.fn(),
  getRun: vi.fn(),
  cancel: vi.fn(),
  sandbox: vi.fn(),
  deleteSandbox: vi.fn(),
  values: new Map<string, string>(),
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
vi.mock("workflow/api", () => ({ start: mocks.start, getRun: mocks.getRun }));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { get: mocks.sandbox } }));
vi.mock("@tailorkit/kv", () => ({
  getKV: () => ({
    get: async (key: string) => mocks.values.get(key) ?? null,
    set: async (key: string, value: string) => {
      mocks.values.set(key, value);
    },
    delete: async (key: string) => {
      mocks.values.delete(key);
    },
    claimUpload: async (owner: string, ended: string, _expected: unknown, value: string) => {
      if (mocks.values.has(owner) || mocks.values.has(ended)) return false;
      mocks.values.set(owner, value);
      return true;
    },
  }),
}));

const { agentRouter, toAgentEvent } = await import("./agent");
const context = { project: { id: "project" }, organization: { id: "org" } } as Context;
const credentials = { deployToken: "token" };
const scope = canonicalizeScope({ name: "org", value: { tenant: "one" } });

function run(parts: unknown[], result: unknown, id = "run-1") {
  return {
    runId: id,
    status: "completed",
    cancel: mocks.cancel,
    returnValue: Promise.resolve(result),
    getReadable: () =>
      new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.values.clear();
  mocks.token.mockResolvedValue({
    id: "cli-one",
    scope: scope.scope,
    scopeKey: scope.scopeKey,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  mocks.sandbox.mockResolvedValue({ delete: mocks.deleteSandbox });
  mocks.getRun.mockReturnValue(
    run([], { messages: [{ role: "assistant", content: "previous" }], sandboxId: "workspace" }),
  );
  mocks.start.mockResolvedValue(
    run(
      [
        { type: "model-call-start" },
        { type: "text-delta", text: "Hello" },
        { type: "tool-call", toolName: "write", toolCallId: "call-1" },
      ],
      { messages: [], sandboxId: "workspace" },
    ),
  );
});

describe("platform builder sessions", () => {
  it("commits tool summaries before the next model attempt resets", () => {
    expect(toAgentEvent({ type: "finish-step" })).toEqual({ type: "step" });
  });
  it("streams text and tool summaries, then continues with authoritative history and workspace", async () => {
    const {
      body: { sessionId },
    } = await call(agentRouter.start, { body: credentials }, { context });
    const stream = await call(
      agentRouter.chat,
      { params: { sessionId }, body: { ...credentials, message: "Build" } },
      { context },
    );
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events).toEqual([
      { type: "step" },
      { type: "text", delta: "Hello" },
      { type: "tool", name: "write", callId: "call-1" },
      { type: "done" },
    ]);
    const next = await call(
      agentRouter.chat,
      { params: { sessionId }, body: { ...credentials, message: "Continue" } },
      { context },
    );
    for await (const _event of next) {
      /* consume */
    }
    expect(mocks.start.mock.lastCall?.[1][0]).toMatchObject({
      appId: `cli-${sessionId}`,
      sandboxId: "workspace",
      messages: [
        { role: "assistant", content: "previous" },
        { role: "user", content: "Continue" },
      ],
    });
    await call(agentRouter.close, { params: { sessionId }, body: credentials }, { context });
    expect(mocks.sandbox).toHaveBeenCalledWith({ name: `app-cli-${sessionId}` });
    expect(mocks.deleteSandbox).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
    await expect(
      call(
        agentRouter.chat,
        { params: { sessionId }, body: { ...credentials, message: "Resume" } },
        { context },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects expired and revoked tokens, and internal runtime credentials", async () => {
    mocks.token.mockResolvedValueOnce({ expiresAt: new Date(0) });
    await expect(call(agentRouter.start, { body: credentials }, { context })).rejects.toMatchObject(
      { code: "UNAUTHORIZED" },
    );
    mocks.token.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: new Date(),
    });
    await expect(call(agentRouter.start, { body: credentials }, { context })).rejects.toMatchObject(
      { code: "UNAUTHORIZED" },
    );
    await expect(
      call(
        agentRouter.start,
        { body: credentials },
        { context: { ...context, runtimeService: true } },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("prevents cross-project and cross-token session access", async () => {
    const {
      body: { sessionId },
    } = await call(agentRouter.start, { body: credentials }, { context });
    await expect(
      call(
        agentRouter.close,
        { params: { sessionId }, body: credentials },
        { context: { ...context, project: { ...context.project, id: "other" } } },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    mocks.token.mockResolvedValueOnce({
      id: "cli-two",
      scope: scope.scope,
      scopeKey: scope.scopeKey,
      expiresAt: new Date(Date.now() + 1000),
    });
    await expect(
      call(agentRouter.close, { params: { sessionId }, body: credentials }, { context }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
  });

  it("allows only one active turn and cleans up an abandoned stream", async () => {
    const {
      body: { sessionId },
    } = await call(agentRouter.start, { body: credentials }, { context });
    const input = { params: { sessionId }, body: { ...credentials, message: "Build" } };
    const stream = await call(agentRouter.chat, input, { context });
    await expect(call(agentRouter.chat, input, { context })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    for await (const _event of stream) break;
    expect(mocks.deleteSandbox).toHaveBeenCalled();
    await expect(call(agentRouter.chat, input, { context })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("terminates a failed run with a simple error event", async () => {
    mocks.start.mockResolvedValueOnce(
      run([{ type: "error", error: new Error("private provider details") }], {}),
    );
    const {
      body: { sessionId },
    } = await call(agentRouter.start, { body: credentials }, { context });
    const stream = await call(
      agentRouter.chat,
      { params: { sessionId }, body: { ...credentials, message: "Build" } },
      { context },
    );
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events).toEqual([
      { type: "error", message: "The builder agent failed. Start a new session." },
    ]);
    expect(mocks.deleteSandbox).toHaveBeenCalled();
  });

  it("ends a failed setup even when the model stream never closes", async () => {
    mocks.start.mockResolvedValue({
      ...run([], {}),
      get returnValue() {
        return Promise.reject(new Error("Sandbox setup failed"));
      },
      getReadable: () => new ReadableStream(),
    });
    const {
      body: { sessionId },
    } = await call(agentRouter.start, { body: credentials }, { context });
    const stream = await call(
      agentRouter.chat,
      { params: { sessionId }, body: { ...credentials, message: "Build" } },
      { context },
    );
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events).toEqual([
      { type: "error", message: "The builder agent failed. Start a new session." },
    ]);
    expect(mocks.deleteSandbox).toHaveBeenCalledOnce();
    expect(mocks.values.has(`agent:session:${sessionId}`)).toBe(false);
  });

  it("cancels active workflow work when the streaming request disconnects", async () => {
    mocks.getRun.mockReturnValue({ ...run([], {}), status: "running" });
    mocks.start.mockResolvedValueOnce({
      ...run([], {}),
      status: "running",
      getReadable: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "model-call-start" });
          },
        }),
    });
    const {
      body: { sessionId },
    } = await call(agentRouter.start, { body: credentials }, { context });
    const controller = new AbortController();
    const stream = await call(
      agentRouter.chat,
      {
        params: { sessionId },
        body: { ...credentials, message: "Build" },
      },
      { context, signal: controller.signal },
    );
    const iterator = stream[Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({ value: { type: "step" } });
    controller.abort();
    await iterator.next().catch(() => {});
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.deleteSandbox).toHaveBeenCalledOnce();
  });
});
