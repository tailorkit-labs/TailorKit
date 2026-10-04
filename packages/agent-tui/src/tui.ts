import {
  BoxRenderable,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { Client, resolveTextToResponses } from "eve/client";
import type { InputRequest, MessageStreamEvent } from "eve/client";

const colors = {
  text: "#E8E8E8",
  muted: "#8C96A7",
  accent: "#6EC8FF",
  user: "#A6E3A1",
  thought: "#B7A7D9",
  tool: "#EFCB80",
  error: "#FF8A8A",
};

function parseOptions(args: string[]) {
  let url = process.env.TAILORKIT_AGENT_URL ?? "http://127.0.0.1:2000";
  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case "--url":
        url = args[++i] ?? "";
        break;
      default:
        throw new Error(`Unknown agent option: ${args[i]}`);
    }
  }
  if (!url) throw new Error("--url needs an agent URL.");
  return { url };
}

function short(value: unknown, max = 500): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function main(): Promise<void> {
  const { url } = parseOptions(process.argv.slice(2));
  const client = new Client({ host: url });
  await client.health();
  const { session } = await client.sessions.create();
  const renderer = await createCliRenderer({ exitOnCtrlC: true });

  const layout = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    paddingLeft: 2,
    paddingRight: 2,
  });
  renderer.root.add(layout);
  layout.add(
    new TextRenderable(renderer, {
      content: `TailorKit agent  ·  ${session.state.sessionId}`,
      fg: colors.accent,
      height: 1,
    }),
  );
  const status = new TextRenderable(renderer, { content: "Ready", fg: colors.muted, height: 1 });
  layout.add(status);

  const transcript = new ScrollBoxRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    stickyScroll: true,
    stickyStart: "bottom",
  });
  layout.add(transcript);

  const composer = new BoxRenderable(renderer, {
    width: "100%",
    flexDirection: "row",
    border: true,
    borderStyle: "single",
    borderColor: colors.muted,
    height: 3,
  });
  composer.add(new TextRenderable(renderer, { content: " > ", fg: colors.accent }));
  const input = new InputRenderable(renderer, {
    width: "auto",
    flexGrow: 1,
    placeholder: "Message the agent…",
    textColor: colors.text,
    cursorColor: colors.accent,
    maxLength: 10_000,
  });
  composer.add(input);
  layout.add(composer);
  layout.add(
    new TextRenderable(renderer, {
      content: "Enter send  ·  /exit quit  ·  Ctrl+C quit",
      fg: colors.muted,
      height: 1,
    }),
  );
  input.focus();

  let busy = false;
  let pendingInput: readonly InputRequest[] = [];
  let lastFailure = "";
  const blocks = new Map<string, { element: TextRenderable; text: string }>();

  const addBlock = (label: string, body: string, color: string): TextRenderable => {
    const block = new BoxRenderable(renderer, {
      width: "100%",
      flexDirection: "column",
      marginBottom: 1,
    });
    block.add(new TextRenderable(renderer, { content: label, fg: color }));
    const text = new TextRenderable(renderer, { content: body, fg: colors.text, width: "100%" });
    block.add(text);
    transcript.add(block);
    return text;
  };

  const updateBlock = (
    key: string,
    label: string,
    delta: string,
    color: string,
    complete = false,
  ) => {
    let block = blocks.get(key);
    if (!block) {
      block = { element: addBlock(label, "", color), text: "" };
      blocks.set(key, block);
    }
    block.text = complete ? delta : block.text + delta;
    block.element.content = block.text;
  };

  const renderEvent = (event: MessageStreamEvent) => {
    switch (event.type) {
      case "message.received":
        lastFailure = "";
        if (event.data.kind !== "execution.background_task")
          addBlock("You", event.data.message, colors.user);
        break;
      case "reasoning.appended":
        updateBlock(
          `${event.data.turnId}:${event.data.stepIndex}:reasoning`,
          "Thinking",
          event.data.reasoningDelta,
          colors.thought,
        );
        status.content = "Thinking…";
        break;
      case "reasoning.completed":
        if (event.data.reasoning)
          updateBlock(
            `${event.data.turnId}:${event.data.stepIndex}:reasoning`,
            "Thinking",
            event.data.reasoning,
            colors.thought,
            true,
          );
        break;
      case "message.appended":
        updateBlock(
          `${event.data.turnId}:${event.data.stepIndex}:message`,
          "Assistant",
          event.data.messageDelta,
          colors.accent,
        );
        status.content = "Streaming…";
        break;
      case "message.completed":
        if (event.data.message)
          updateBlock(
            `${event.data.turnId}:${event.data.stepIndex}:message`,
            "Assistant",
            event.data.message,
            colors.accent,
            true,
          );
        break;
      case "actions.requested":
        for (const action of event.data.actions) {
          const name =
            "toolName" in action ? action.toolName : "name" in action ? action.name : "load_skill";
          addBlock(`Tool · ${name}`, short(action.input, 300), colors.tool);
        }
        status.content = "Running tools…";
        break;
      case "action.result": {
        const result = event.data.result;
        const name =
          "toolName" in result
            ? result.toolName
            : "subagentName" in result
              ? result.subagentName
              : (result.name ?? "load_skill");
        const failed = event.data.status === "failed";
        addBlock(
          `Result · ${name}${event.data.status === "completed" ? "" : ` (${event.data.status})`}`,
          event.data.error?.message ?? short(result.output),
          failed ? colors.error : colors.muted,
        );
        break;
      }
      case "input.requested":
        pendingInput = event.data.requests;
        for (const request of pendingInput) {
          const choices = request.options
            ?.map((option: { label: string }, index: number) => `${index + 1}. ${option.label}`)
            .join("  ");
          addBlock(
            "Agent needs input",
            [request.prompt, choices].filter(Boolean).join("\n"),
            colors.tool,
          );
        }
        status.content = "Reply to the request above";
        break;
      case "input.resolved":
        pendingInput = [];
        break;
      case "authorization.required":
        addBlock("Authorization needed", event.data.description, colors.tool);
        status.content = "Waiting for authorization";
        break;
      case "step.failed":
      case "turn.failed":
      case "session.failed":
        if (event.data.message !== lastFailure) addBlock("Error", event.data.message, colors.error);
        lastFailure = event.data.message;
        status.content = "Error";
        break;
      case "turn.cancelled":
        addBlock("Status", "Turn cancelled", colors.muted);
        break;
      case "session.waiting":
        if (pendingInput.length === 0) status.content = "Ready";
        break;
      case "session.completed":
        status.content = "Session completed";
        break;
    }
  };

  input.on(InputRenderableEvents.ENTER, (submitted: string) => {
    const message = submitted.trim();
    if (message === "/exit" || message === "/quit") {
      renderer.destroy();
      process.exit(0);
    }
    if (!message || busy) return;
    const responses = pendingInput.length ? resolveTextToResponses(message, pendingInput) : [];
    if (pendingInput.length && responses.length !== pendingInput.length) {
      status.content = "Choose an option number or enter an allowed answer";
      return;
    }
    input.value = "";
    busy = true;
    status.content = "Sending…";
    void (async () => {
      try {
        const response = pendingInput.length
          ? await session.respond(responses)
          : await session.send(message);
        for await (const event of response) renderEvent(event);
        if (pendingInput.length === 0) status.content = "Ready";
      } catch (error) {
        addBlock("Error", error instanceof Error ? error.message : String(error), colors.error);
        status.content = "Send failed · retry your message";
      } finally {
        busy = false;
        input.focus();
      }
    })();
  });

  await new Promise<void>(() => {});
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
