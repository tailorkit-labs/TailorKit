import { eventIterator, ORPCError } from "@orpc/server";
import { agentChatSchema, agentChunkSchema } from "@tailorkit/client-platform/agent";
import { agentChat } from "@tailorkit/client-platform/client";
import { getCliDeployToken, o, requireCliDeployToken } from "../procedures";

/** CLI calls the host; only the host supplies the platform project credential. */
export const agentRouter = {
  chat: o
    .use(requireCliDeployToken)
    .input(agentChatSchema)
    .output(eventIterator(agentChunkSchema))
    .handler(async function* ({ context, input, signal: clientSignal }) {
      const controller = new AbortController();
      const signal = clientSignal
        ? AbortSignal.any([clientSignal, controller.signal])
        : controller.signal;
      try {
        let streamError: unknown;
        let done = false;
        const { stream } = await agentChat({
          body: { ...input, deployToken: getCliDeployToken(context.request) },
          client: context.platform,
          headers: context.platformHeaders,
          signal,
          // Replaying a POST could start the agent twice. V1 has no reconnection.
          sseMaxRetryAttempts: 1,
          onSseError: (error) => {
            streamError = error;
          },
        });
        for await (const value of stream) {
          const event = await agentChunkSchema.parseAsync(value);
          if (event.type === "finish" || event.type === "error") done = true;
          yield event;
        }
        signal?.throwIfAborted();
        if (streamError)
          throw new ORPCError("BAD_GATEWAY", {
            message: "The builder agent stream failed. Start a new session.",
          });
        if (!done)
          throw new ORPCError("BAD_GATEWAY", {
            message: "The agent stream ended unexpectedly. Start a new session.",
          });
      } finally {
        // Iterator cancellation must also terminate the upstream HTTP stream.
        controller.abort();
      }
    }),
};
