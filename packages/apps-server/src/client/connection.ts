import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import { AppError, appError } from "../errors";
import type { Reference } from "./reference";
export { reference } from "./reference";
export type { Reference, References } from "./reference";
export { AppError } from "../errors";

export interface Session {
  token: string;
  expiresAt: number;
  url: string;
}
export interface Client {
  query<I, O>(reference: Reference<"query", I, O>, args: I): Promise<O>;
  mutate<I, O>(
    reference: Reference<"mutation", I, O>,
    args: I,
    options?: { requestId?: string },
  ): Promise<O>;
  action<I, O>(reference: Reference<"action", I, O>, args: I): Promise<O>;
  subscribe<I, O>(
    reference: Reference<"query", I, O>,
    args: I,
    next: (value: O) => void,
    options?: { onError?: (error: AppError) => void },
  ): () => void;
  close(): void;
}
type Wire = {
  query(input: { name: string; args: unknown }): Promise<unknown>;
  action(input: { name: string; args: unknown }): Promise<unknown>;
  mutate(input: { name: string; args: unknown; requestId: string }): Promise<unknown>;
  subscribe(
    input: { name: string; args: unknown },
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<unknown>>;
};
export function createClient(
  options: {
    getSession?: (options: { refresh: boolean }) => Promise<Session>;
    connect?: (url: string, protocols: string[]) => WebSocket | Promise<WebSocket>;
    retryDelayMs?: number;
  } = {},
): Client {
  let closed = false;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stops = new Set<() => void>();
  const getSession =
    options.getSession ??
    ((request: { refresh: boolean }) => {
      const bridge = (
        globalThis as typeof globalThis & {
          __tailorkitBackendSession?: (options: { refresh: boolean }) => Promise<Session>;
        }
      ).__tailorkitBackendSession;
      if (!bridge) throw new AppError("UNAVAILABLE", "The host JWT bridge is unavailable");
      return bridge(request);
    });
  const wire = createORPCClient<Wire>(
    new RPCLink({
      connect: async (info) => {
        if (closed) throw new AppError("UNAVAILABLE", "App client closed");
        const session = await getSession({ refresh: info.totalAttempt > 1 });
        if (closed) throw new AppError("UNAVAILABLE", "App client closed");
        const url = new URL(session.url);
        if (url.username || url.password || url.search || url.hash)
          throw new AppError("BAD_REQUEST", "Invalid app backend URL");
        if (url.protocol === "https:") url.protocol = "wss:";
        if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
          url.protocol = "ws:";
        if (
          !(
            ["wss:"].includes(url.protocol) ||
            (url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
          )
        )
          throw new AppError("BAD_REQUEST", "App backends require a secure WebSocket URL");
        if (session.expiresAt <= Date.now() + 1000)
          throw new AppError("UNAUTHORIZED", "App token expired");
        socket = await (options.connect ?? ((url, protocols) => new WebSocket(url, protocols)))(
          url.href,
          ["tailorkit", `jwt.${session.token}`],
        );
        // Reconnect before expiry. Active subscriptions obtain fresh snapshots automatically.
        clearTimeout(timer);
        timer = setTimeout(
          () => socket?.close(1000, "Renew authentication"),
          Math.max(500, session.expiresAt - Date.now() - 5000),
        );
        return socket;
      },
      reconnect: {
        enabled: true,
        maxAttempt: 3,
        delay: (info) => (info.attempt === 1 ? 0 : (options.retryDelayMs ?? 1000)),
      },
    }),
  );
  async function call(run: () => Promise<unknown>) {
    if (closed) throw new AppError("UNAVAILABLE", "App client closed");
    try {
      return await run();
    } catch (error) {
      throw appError(error);
    }
  }
  return {
    query: (ref, args) => call(() => wire.query({ name: ref.name, args })) as Promise<never>,
    mutate: (ref, args, settings) =>
      call(() =>
        wire.mutate({
          name: ref.name,
          args,
          requestId: settings?.requestId ?? crypto.randomUUID(),
        }),
      ) as Promise<never>,
    action: (ref, args) => call(() => wire.action({ name: ref.name, args })) as Promise<never>,
    subscribe(ref, args, next, settings = {}) {
      if (closed) throw new AppError("UNAVAILABLE", "App client closed");
      const controller = new AbortController();
      const stop = () => {
        controller.abort();
        stops.delete(stop);
      };
      stops.add(stop);
      const run = async () => {
        while (!controller.signal.aborted && !closed) {
          try {
            const stream = await wire.subscribe(
              { name: ref.name, args },
              { signal: controller.signal },
            );
            for await (const value of stream) {
              if (controller.signal.aborted || closed) break;
              next(value as never);
            }
          } catch (error) {
            if (controller.signal.aborted || closed) break;
            const failure = appError(error);
            if (!(error instanceof Error && error.name === "AbortError"))
              settings.onError?.(failure);
            if (!["UNAUTHORIZED", "UNAVAILABLE", "INTERNAL_SERVER_ERROR"].includes(failure.code))
              break;
          }
          if (!controller.signal.aborted && !closed)
            await new Promise<void>((resolve) => {
              const wake = () => {
                clearTimeout(delay);
                controller.signal.removeEventListener("abort", wake);
                resolve();
              };
              const delay = setTimeout(wake, options.retryDelayMs ?? 1000);
              controller.signal.addEventListener("abort", wake, { once: true });
            });
        }
        stop();
      };
      void run().catch((error) => {
        stop();
        settings.onError?.(appError(error));
      });
      return stop;
    },
    close() {
      closed = true;
      for (const stop of stops) stop();
      clearTimeout(timer);
      socket?.close();
    },
  };
}

export { createSessionProvider } from "./host";
