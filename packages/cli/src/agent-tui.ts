import { runAgentTUI } from "@ai-sdk/tui";
import { asyncIteratorToUnproxiedDataStream } from "@orpc/client";
import type { TailorKitRouterClient } from "@tailorkit/core/server";
import type { ChatTransport, UIMessage } from "ai";
import { fetchSchemaFromHost, type TailorKitSchemaFile } from "./generator/types";

const schemaFetchTimeoutMs = 10_000;

interface AgentTuiOptions {
  client: Pick<TailorKitRouterClient, "appAgent">;
  hostUrl: string;
  appId: string;
}

export async function openAgentTui({ client, hostUrl, appId }: AgentTuiOptions) {
  const transport: ChatTransport<UIMessage> = {
    async sendMessages({ messages, abortSignal }) {
      const timeoutSignal = AbortSignal.timeout(schemaFetchTimeoutMs);
      const schemaSignal = abortSignal
        ? AbortSignal.any([abortSignal, timeoutSignal])
        : timeoutSignal;
      let schema: TailorKitSchemaFile;
      try {
        schemaSignal.throwIfAborted();
        schema = await fetchSchemaFromHost(hostUrl, schemaSignal);
        schemaSignal.throwIfAborted();
      } catch (error) {
        abortSignal?.throwIfAborted();
        const detail = timeoutSignal.aborted
          ? "Timed out after 10 seconds."
          : error instanceof Error
            ? error.message
            : String(error);
        throw new Error(`Unable to fetch the host schema from ${hostUrl}: ${detail}`, {
          cause: error,
        });
      }
      const chunks = await client.appAgent.chat(
        {
          appId,
          hostUrl,
          schema,
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
