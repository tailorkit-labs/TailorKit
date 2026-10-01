import { asyncIteratorObject, ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/websocket";
import { z } from "zod";
import { invocationSchema } from "./execution";
import type { Identity } from "./functions";
import { appError } from "./errors";
import { createRealtime } from "./realtime";

function wireError(error: unknown) {
  const failure = appError(error);
  return new ORPCError(failure.code, { message: failure.message });
}

/** Only the latest complete snapshot is buffered for a slow subscriber. */
function snapshots(
  start: (next: (value: unknown) => void, fail: (error: unknown) => void) => () => void,
  signal?: AbortSignal,
) {
  let pending: { value: unknown } | undefined;
  let failure: unknown;
  let ended = false;
  let wake: (() => void) | undefined;
  const stop = start(
    (value) => {
      pending = { value };
      wake?.();
    },
    (error) => {
      failure = wireError(error);
      wake?.();
    },
  );
  function close() {
    ended = true;
    stop();
    wake?.();
    signal?.removeEventListener("abort", close);
  }
  signal?.addEventListener("abort", close, { once: true });
  if (signal?.aborted) close();
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    [Symbol.asyncDispose]: async () => {
      close();
    },
    async next(): Promise<IteratorResult<unknown>> {
      while (!ended) {
        if (failure) {
          close();
          throw failure;
        }
        if (pending) {
          const value = pending.value;
          pending = undefined;
          return { done: false, value };
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
      return { done: true, value: undefined };
    },
    async return(): Promise<IteratorResult<unknown>> {
      close();
      return { done: true, value: undefined };
    },
  };
}

export function createRpcConnection(
  realtime: ReturnType<typeof createRealtime>,
  socket: Pick<WebSocket, "send" | "addEventListener" | "removeEventListener" | "close">,
  identity: Identity,
) {
  const base = os.$context<Record<string, never>>();
  const handler = new RPCHandler({
    query: base.input(invocationSchema).handler(async ({ input }) => {
      try {
        return await realtime.query(input, identity);
      } catch (error) {
        throw wireError(error);
      }
    }),
    mutate: base
      .input(invocationSchema.extend({ requestId: z.uuid() }))
      .handler(async ({ input }) => {
        try {
          return await realtime.mutate(input, identity);
        } catch (error) {
          throw wireError(error);
        }
      }),
    subscribe: base
      .input(invocationSchema)
      .output(asyncIteratorObject(z.unknown()))
      .handler(({ input, signal }) =>
        snapshots((next, fail) => realtime.subscribe(input, identity, next, fail), signal),
      ),
  });
  // Reject expired or oversized frames before oRPC decodes them.
  const listeners = new Map<EventListenerOrEventListenerObject, EventListener>();
  const guarded: typeof socket = {
    send: socket.send.bind(socket),
    close: socket.close.bind(socket),
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (!listener) return;
      const wrapped: EventListener = (event) => {
        if (type === "message") {
          if (identity.expiresAt <= Date.now()) {
            socket.close(1008, "Authentication expired");
            return;
          }
          const data = (event as MessageEvent).data;
          const size =
            typeof data === "string"
              ? new TextEncoder().encode(data).byteLength
              : data instanceof ArrayBuffer
                ? data.byteLength
                : Infinity;
          if (size > 1024 * 1024) {
            socket.close(1009, "Request too large");
            return;
          }
        }
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      };
      listeners.set(listener, wrapped);
      socket.addEventListener(type, wrapped, options);
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (!listener) return;
      const wrapped = listeners.get(listener);
      if (wrapped) socket.removeEventListener(type, wrapped, options);
      listeners.delete(listener);
    },
  };
  handler.upgrade(guarded, { context: {} });
  return { close: () => handler.close(guarded) };
}
