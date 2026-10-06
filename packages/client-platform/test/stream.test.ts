import { describe, expect, it, vi } from "vite-plus/test";
import { createSseClient } from "../src/client/core/serverSentEvents.gen";

describe("generated SSE cancellation", () => {
  it("handles a body that rejects cancellation when the connection closes", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => Promise.reject(new DOMException("Connection closed", "AbortError")));
    const { stream } = createSseClient({
      url: "https://platform.test/agent/chat",
      method: "POST",
      signal: controller.signal,
      sseMaxRetryAttempts: 1,
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(output) {
              output.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'));
            },
            cancel,
          }),
        ),
    });
    expect(await stream.next()).toMatchObject({ value: { type: "start" } });
    controller.abort();
    expect(await stream.next()).toMatchObject({ done: true });
    // Let rejected cancellation promises settle; the test runner detects any
    // unhandled rejection rather than merely checking the generated source.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
