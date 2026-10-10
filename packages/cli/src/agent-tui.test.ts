import type { TailorKitRouterClient } from "@tailorkit/core/server";
import { readUIMessageStream, type UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ tui: vi.fn(), fetchSchema: vi.fn() }));
vi.mock("@ai-sdk/tui", () => ({ runAgentTUI: mocks.tui }));
vi.mock("./generator/types", () => ({ fetchSchemaFromHost: mocks.fetchSchema }));
const { openAgentTui } = await import("./agent-tui");
const appId = "a3e7568a-c4f7-4ac0-8c35-71ff0f4cd002";
const messages: UIMessage[] = [
  { id: "user-1", role: "user", parts: [{ type: "text", text: "Build" }] },
  {
    id: "assistant-1",
    role: "assistant",
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
  { id: "user-2", role: "user", parts: [{ type: "text", text: "Continue" }] },
];
const hostUrl = "http://localhost:3000/api/tailorkit";
const schema = { version: 1, components: {}, views: {}, slots: {}, tools: {} };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSchema.mockResolvedValue(schema);
});
afterEach(() => vi.restoreAllMocks());

const waitForAbort = (_host: string, signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

describe("AI SDK terminal transport", () => {
  it("forwards the SDK's complete history and abort signal to the host client", async () => {
    const chat = vi.fn(
      async (
        _input: Parameters<TailorKitRouterClient["appAgent"]["chat"]>[0],
        _options?: Parameters<TailorKitRouterClient["appAgent"]["chat"]>[1],
      ) =>
        (async function* () {
          yield { type: "start" as const, messageId: "run-2" };
          yield { type: "text-start" as const, id: "text" };
          yield { type: "text-delta" as const, id: "text", delta: "Continued" };
          yield { type: "text-end" as const, id: "text" };
          yield { type: "finish" as const };
        })(),
    );
    await openAgentTui({ client: { appAgent: { chat } }, hostUrl, appId });
    const options = mocks.tui.mock.lastCall![0];
    expect(options).toMatchObject({
      title: `TailorKit Agent · ${hostUrl}`,
      tools: "collapsed",
      reasoning: "hidden",
    });
    const controller = new AbortController();
    const stream = await options.transport.sendMessages({
      chatId: "sdk-chat-id",
      trigger: "submit-message",
      messageId: undefined,
      messages,
      abortSignal: controller.signal,
    });
    let answer;
    for await (const message of readUIMessageStream({ stream, terminateOnError: true }))
      answer = message;
    expect(answer).toMatchObject({ id: "run-2", parts: [{ type: "text", text: "Continued" }] });
    expect(mocks.fetchSchema).toHaveBeenCalledExactlyOnceWith(hostUrl, expect.any(AbortSignal));
    const schemaSignal = mocks.fetchSchema.mock.calls[0]![1] as AbortSignal;
    expect(schemaSignal.aborted).toBe(false);
    expect(chat).toHaveBeenCalledWith(
      { appId, hostUrl, schema, messages },
      { signal: controller.signal },
    );

    const updatedSchema = { ...schema, views: { "/detail": {} } };
    mocks.fetchSchema.mockResolvedValueOnce(updatedSchema);
    await options.transport.sendMessages({ messages, abortSignal: controller.signal });
    expect(chat).toHaveBeenLastCalledWith(
      { appId, hostUrl, schema: updatedSchema, messages },
      { signal: controller.signal },
    );
    controller.abort();
    expect(schemaSignal.aborted).toBe(true);
    expect(chat.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(await options.transport.reconnectToStream({ chatId: "sdk-chat-id" })).toBeNull();
  });

  it.each([new Error("Local host unavailable"), "Local host unavailable"])(
    "reports schema fetch failures with their cause and does not start a remote run: %s",
    async (cause) => {
      const chat = vi.fn();
      mocks.fetchSchema.mockRejectedValueOnce(cause);
      await openAgentTui({ client: { appAgent: { chat } }, hostUrl, appId });
      await expect(
        mocks.tui.mock.lastCall![0].transport.sendMessages({ messages }),
      ).rejects.toMatchObject({
        message: `Unable to fetch the host schema from ${hostUrl}: Local host unavailable`,
        cause,
      });
      expect(chat).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, new AbortController().signal])(
    "times out a stalled schema fetch, with user signal %s, before starting a remote run",
    async (abortSignal) => {
      const timeout = AbortSignal.timeout;
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(1));
      mocks.fetchSchema.mockImplementationOnce(waitForAbort);
      const chat = vi.fn();
      await openAgentTui({ client: { appAgent: { chat } }, hostUrl, appId });
      await expect(
        mocks.tui.mock.lastCall![0].transport.sendMessages({ messages, abortSignal }),
      ).rejects.toMatchObject({
        message: `Unable to fetch the host schema from ${hostUrl}: Timed out after 10 seconds.`,
        cause: expect.objectContaining({ name: "TimeoutError" }),
      });
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
      expect(chat).not.toHaveBeenCalled();
    },
  );

  it("honors user cancellation during a schema fetch without starting a remote run", async () => {
    mocks.fetchSchema.mockImplementationOnce(waitForAbort);
    const chat = vi.fn();
    const controller = new AbortController();
    await openAgentTui({ client: { appAgent: { chat } }, hostUrl, appId });
    const sending = mocks.tui.mock.lastCall![0].transport.sendMessages({
      messages,
      abortSignal: controller.signal,
    });
    const reason = new DOMException("Cancelled by user", "AbortError");
    const aborted = expect(sending).rejects.toBe(reason);
    controller.abort(reason);
    await aborted;
    expect(chat).not.toHaveBeenCalled();
  });
});
