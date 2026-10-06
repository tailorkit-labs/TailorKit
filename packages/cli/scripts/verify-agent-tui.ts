import assert from "node:assert/strict";
import { createTestRenderer } from "@opentui/core/testing";
import type { TailorKitRouterClient } from "@tailorkit/core/server";
import { mountAgentTui } from "../src/agent-tui";

// Run with Bun so verification exercises OpenTUI's actual native renderer.
const ui = await createTestRenderer({ width: 90, height: 24 });
let exit = false;
let calls = 0;
let finish!: () => void;
const pending = new Promise<void>((resolve) => {
  finish = resolve;
});
const client = {
  agent: {
    chat: async function* () {
      calls += 1;
      yield { type: "start", messageId: "answer" };
      yield { type: "start-step" };
      yield { type: "text-start", id: "intro" };
      yield { type: "text-delta", id: "intro", delta: "Building " };
      yield { type: "text-end", id: "intro" };
      yield { type: "tool-input-available", toolName: "write", toolCallId: "one", input: {} };
      await pending;
      yield { type: "tool-output-available", toolCallId: "one", output: { success: true } };
      yield { type: "finish-step" };
      yield { type: "start-step" };
      yield { type: "text-start", id: "retry" };
      yield { type: "text-delta", id: "retry", delta: "discard me" };
      yield { type: "reset-step" };
      yield { type: "text-start", id: "answer" };
      yield { type: "text-delta", id: "answer", delta: "your app." };
      yield { type: "text-end", id: "answer" };
      yield { type: "finish-step" };
      yield { type: "finish" };
    },
  },
} as unknown as Pick<TailorKitRouterClient, "agent">;

const dispose = mountAgentTui(
  ui.renderer,
  { client, hostUrl: "https://host.test", sessionId: "test" },
  () => {
    exit = true;
  },
);
try {
  await ui.mockInput.typeText("Create a notes app");
  ui.mockInput.pressEnter();
  await ui.waitForFrame((frame) => frame.includes("Building") && frame.includes("write"));
  ui.mockInput.pressEnter();
  assert.equal(calls, 1, "Enter during streaming must not start another turn");
  finish();
  await ui.waitForFrame(
    (frame) => frame.includes("Building your app.") && frame.includes("Tools (1): write"),
  );
  const frame = ui.captureCharFrame();
  assert.match(frame, /You: Create a notes app/u);
  assert.match(frame, /Enter to send/u);
  assert.doesNotMatch(frame, /discard me/u);
  ui.resize(60, 18);
  await ui.flush();
  assert.match(ui.captureCharFrame(), /Building your app\./u);
  ui.mockInput.pressCtrlC();
  assert.equal(exit, true, "Ctrl+C must close the session");
  console.log(
    "Native OpenTUI verification passed: input, incremental text, tool names, busy state, resize, and Ctrl+C.",
  );
} finally {
  dispose();
  ui.renderer.destroy();
}
