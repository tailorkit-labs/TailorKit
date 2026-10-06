import { runAgentTUI } from "@ai-sdk/tui";
import { asyncIteratorToUnproxiedDataStream } from "@orpc/client";
import type { TailorKitRouterClient } from "@tailorkit/core/server";
import type { ChatTransport, UIMessage } from "ai";

interface AgentTuiOptions {
  client: Pick<TailorKitRouterClient, "agent">;
  hostUrl: string;
  sessionId: string;
}

export async function openAgentTui({ client, hostUrl, sessionId }: AgentTuiOptions) {
  const transport: ChatTransport<UIMessage> = {
    async sendMessages({ messages, abortSignal }) {
      const chunks = await client.agent.chat(
        {
          sessionId,
          messages: messages.filter(
            (message): message is UIMessage & { role: "user" | "assistant" } =>
              message.role !== "system",
          ),
        },
        { signal: abortSignal },
      );
      return asyncIteratorToUnproxiedDataStream(chunks);
    },
    async reconnectToStream() {
      return null;
    },
  };
  await runAgentTUI({
    title: `TailorKit Agent · ${hostUrl}`,
    transport,
    tools: "collapsed",
    reasoning: "hidden",
  });
}
