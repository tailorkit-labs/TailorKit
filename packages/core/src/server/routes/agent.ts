import { eventIterator, ORPCError } from "@orpc/server";
import { createORPCErrorFromJson, isORPCErrorJson } from "@orpc/client";
import { agentEventSchema, agentMessageSchema } from "@tailorkit/client-platform/agent";
import { agentChat, agentClose, agentStart } from "@tailorkit/client-platform/client";
import { z } from "zod";
import { getCliDeployToken, o, requireCliDeployToken } from "../procedures";

const sessionInput = z.object({ sessionId: z.uuid() });

async function platformRequest<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (isORPCErrorJson(error)) throw createORPCErrorFromJson(error);
    throw error;
  }
}

/** CLI calls the host; only the host supplies the platform project credential. */
export const agentRouter = {
  start: o
    .use(requireCliDeployToken)
    .input(z.object({}))
    .handler(
      async ({ context }) =>
        await platformRequest(
          agentStart({
            body: { deployToken: getCliDeployToken(context.request) },
            client: context.platform,
            headers: context.platformHeaders,
          }),
        ),
    ),
  chat: o
    .use(requireCliDeployToken)
    .input(sessionInput.extend({ message: agentMessageSchema }))
    .output(eventIterator(agentEventSchema))
    .handler(async function* ({ context, input, signal: clientSignal }) {
      const controller = new AbortController();
      const signal = clientSignal
        ? AbortSignal.any([clientSignal, controller.signal])
        : controller.signal;
      try {
        let streamError: unknown;
        let done = false;
        const { stream } = await agentChat({
          body: { deployToken: getCliDeployToken(context.request), message: input.message },
          path: { sessionId: input.sessionId },
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
          const event = agentEventSchema.parse(value);
          if (event.type === "done" || event.type === "error") done = true;
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
  close: o
    .use(requireCliDeployToken)
    .input(sessionInput)
    .handler(
      async ({ context, input }) =>
        await platformRequest(
          agentClose({
            body: { deployToken: getCliDeployToken(context.request) },
            path: { sessionId: input.sessionId },
            client: context.platform,
            headers: context.platformHeaders,
          }),
        ),
    ),
};
