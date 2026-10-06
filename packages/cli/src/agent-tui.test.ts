import type { TailorKitRouterClient } from "@tailorkit/core/server";
import { readUIMessageStream, type UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ tui: vi.fn() }));
vi.mock("@ai-sdk/tui", () => ({ runAgentTUI: mocks.tui }));
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
beforeEach(() => vi.clearAllMocks());

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
    await openAgentTui({ client: { appAgent: { chat } }, hostUrl: "https://host.test", appId });
    const options = mocks.tui.mock.lastCall![0];
    expect(options).toMatchObject({
      title: "TailorKit Agent · https://host.test",
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
    expect(chat).toHaveBeenCalledWith({ appId, messages }, { signal: controller.signal });
    controller.abort();
    expect(chat.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(await options.transport.reconnectToStream({ chatId: "sdk-chat-id" })).toBeNull();
  });
});
