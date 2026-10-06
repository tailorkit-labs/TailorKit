import { randomUUID } from "node:crypto";
import {
  BoxRenderable,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { TailorKitRouterClient } from "@tailorkit/core/server";
import { asyncIteratorToUnproxiedDataStream } from "@orpc/client";
import { getToolName, isToolUIPart, readUIMessageStream, type UIMessage } from "ai";

interface AgentTuiOptions {
  client: Pick<TailorKitRouterClient, "agent">;
  hostUrl: string;
  sessionId: string;
}

/** Conversation history exists only in this CLI process. */
export function mountAgentTui(renderer: CliRenderer, options: AgentTuiOptions, onExit: () => void) {
  const layout = new BoxRenderable(renderer, {
    id: "agent",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    padding: 1,
    gap: 1,
  });
  const title = new TextRenderable(renderer, {
    id: "title",
    content: `TailorKit Agent · ${options.hostUrl}`,
    fg: "#9ece6a",
  });
  const transcript = new ScrollBoxRenderable(renderer, {
    id: "transcript",
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
  });
  const welcome = new TextRenderable(renderer, {
    id: "welcome",
    content: "Describe the app you want to build. This conversation ends when you leave.",
    fg: "#a9b1d6",
  });
  transcript.add(welcome);
  const status = new TextRenderable(renderer, {
    id: "status",
    content: "Enter to send · /exit or Ctrl+C to close",
    fg: "#a9b1d6",
  });
  const inputBox = new BoxRenderable(renderer, {
    id: "input-box",
    border: true,
    borderColor: "#7aa2f7",
    padding: 1,
    flexShrink: 0,
  });
  const input = new InputRenderable(renderer, {
    id: "message",
    placeholder: "Message the builder agent…",
    maxLength: 32_000,
    width: "100%",
  });
  inputBox.add(input);
  layout.add(title);
  layout.add(transcript);
  layout.add(status);
  layout.add(inputBox);
  renderer.root.add(layout);
  input.focus();

  const history: (UIMessage & { role: "user" | "assistant" })[] = [];
  let busy = false;
  let closed = false;
  let turn = 0;
  let controller: AbortController | undefined;

  const submit = async () => {
    const message = input.value.trim();
    if (closed || busy || !message) return;
    if (message === "/exit" || message === "/quit") {
      onExit();
      return;
    }
    input.value = "";
    busy = true;
    input.blur();
    controller = new AbortController();
    turn += 1;
    transcript.add(
      new TextRenderable(renderer, {
        id: `user-${turn}`,
        content: `You: ${message}`,
        marginBottom: 1,
        fg: "#7aa2f7",
        flexShrink: 0,
      }),
    );
    const response = new TextRenderable(renderer, {
      id: `assistant-${turn}`,
      content: "Agent: ",
      flexShrink: 0,
    });
    transcript.add(response);
    let usedTools: string[] = [];
    status.content = "Agent is thinking… · Ctrl+C to close";

    history.push({ id: randomUUID(), role: "user", parts: [{ type: "text", text: message }] });
    let answer: UIMessage | undefined;
    try {
      const chunks = await options.client.agent.chat(
        { sessionId: options.sessionId, messages: history },
        { signal: controller.signal },
      );
      // oRPC attaches event metadata via proxies. The SDK clones message parts,
      // so unwrap transport data using the documented AI SDK integration.
      const messages = readUIMessageStream<UIMessage>({
        message: { id: randomUUID(), role: "assistant", parts: [] },
        stream: asyncIteratorToUnproxiedDataStream(chunks),
        terminateOnError: true,
      });
      for await (const message of messages) {
        if (closed) break;
        answer = message;
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
        response.content = `Agent: ${text}`;
        usedTools = message.parts.filter(isToolUIPart).map(getToolName);
        status.content = usedTools.length
          ? `Tools: ${usedTools.join(", ")} · Ctrl+C to close`
          : "Agent is thinking… · Ctrl+C to close";
      }
      if (!closed) {
        if (answer) history.push({ ...answer, role: "assistant" });
        if (usedTools.length)
          transcript.add(
            new TextRenderable(renderer, {
              id: `tools-${turn}`,
              content: `Tools (${usedTools.length}): ${usedTools.join(", ")}`,
              fg: "#a9b1d6",
              marginBottom: 1,
              flexShrink: 0,
            }),
          );
        status.content = "Enter to send · /exit or Ctrl+C to close";
      }
    } catch (error) {
      if (!closed) {
        status.content = error instanceof Error ? error.message : "Agent request failed.";
        // Do not send incomplete tool history in another turn.
        input.placeholder = "Session ended. Press Ctrl+C to close.";
        return;
      }
    } finally {
      controller = undefined;
    }
    busy = false;
    if (!closed) input.focus();
  };

  const keypress: Parameters<CliRenderer["keyInput"]["on"]>[1] = (key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      onExit();
    }
  };
  input.on(InputRenderableEvents.ENTER, () => {
    void submit();
  });
  renderer.keyInput.on("keypress", keypress);
  return () => {
    closed = true;
    controller?.abort();
    renderer.keyInput.off("keypress", keypress);
  };
}

export async function openAgentTui(options: AgentTuiOptions) {
  let resolveExit!: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const renderer = await createCliRenderer({ exitOnCtrlC: false, onDestroy: resolveExit });
  const stop = () => {
    renderer.destroy();
    resolveExit();
  };
  let dispose: (() => void) | undefined;
  process.once("SIGTERM", stop);
  try {
    dispose = mountAgentTui(renderer, options, stop);
    await exited;
  } finally {
    dispose?.();
    process.off("SIGTERM", stop);
    renderer.destroy();
  }
}
