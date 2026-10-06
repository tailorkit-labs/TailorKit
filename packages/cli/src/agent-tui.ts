import { runAgentTUI } from "@ai-sdk/tui";
import { asyncIteratorToUnproxiedDataStream } from "@orpc/client";
import type { TailorKitRouterClient } from "@tailorkit/core/server";
import type { ChatTransport, UIMessage } from "ai";

interface AgentTuiOptions {
  client: Pick<TailorKitRouterClient, "appAgent">;
  hostUrl: string;
  appId: string;
}

export async function openAgentTui({ client, hostUrl, appId }: AgentTuiOptions) {
  const transport: ChatTransport<UIMessage> = {
    async sendMessages({ messages, abortSignal }) {
      const chunks = await client.appAgent.chat(
        {
          appId,
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
