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
import type { AgentEvent } from "@tailorkit/client-platform/agent";

interface AgentTuiOptions {
  client: Pick<TailorKitRouterClient, "agent">;
  hostUrl: string;
  sessionId: string;
}

/** The CLI owns only display state. Full model/tool history remains on the platform. */
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
    let text = "";
    let stepText = "";
    let stepTools: string[] = [];
    const tools: string[] = [];
    const calls = new Set<string>();
    let finished = false;
    status.content = "Agent is thinking… · Ctrl+C to close";

    const display = (event: AgentEvent) => {
      switch (event.type) {
        case "text":
          stepText += event.delta;
          response.content = `Agent: ${text}${stepText}`;
          break;
        case "tool":
          if (!calls.has(event.callId)) {
            calls.add(event.callId);
            stepTools.push(event.name);
          }
          status.content = `Tools: ${[...tools, ...stepTools].join(", ")} · Ctrl+C to close`;
          break;
        case "step":
          text += stepText;
          tools.push(...stepTools);
          stepText = "";
          stepTools = [];
          calls.clear();
          break;
        case "reset":
          stepText = "";
          stepTools = [];
          calls.clear();
          response.content = `Agent: ${text}`;
          status.content = "Agent is thinking… · Ctrl+C to close";
          break;
        case "done":
          finished = true;
          break;
        case "error":
          throw new Error(event.message);
      }
    };

    try {
      const stream = await options.client.agent.chat(
        { sessionId: options.sessionId, message },
        { signal: controller.signal },
      );
      for await (const event of stream) {
        if (closed) break;
        display(event);
      }
      if (!closed && !finished)
        throw new Error("The agent disconnected. Close this session and start a new one.");
      if (!closed) {
        const usedTools = [...tools, ...stepTools];
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
        // A failed stream ends the remote session; don't allow a misleading retry.
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
