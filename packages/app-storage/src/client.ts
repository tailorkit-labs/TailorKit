import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { StorageError, storageError } from "./errors";
import type { FunctionReference } from "./reference";

interface Snapshot {
  value: unknown;
  revision: number;
}
// A local wire contract keeps server implementations and oRPC types out of public declarations.
interface WireClient {
  query(input: WireInvocation, options?: { signal?: AbortSignal }): Promise<Snapshot>;
  mutate(
    input: WireInvocation & { requestId: string },
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  subscribe(
    input: WireInvocation,
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<Snapshot>>;
}
interface WireInvocation {
  name: string;
  input: unknown;
  apiVersion: number;
}
export interface StorageSession {
  token: string;
  expiresAt: number;
  url: string;
}
export interface StorageClient {
  query<I, O>(reference: FunctionReference<"query", I, O>, input: I): Promise<O>;
  mutate<I, O>(
    reference: FunctionReference<"mutation", I, O>,
    input: I,
    options?: { requestId?: string },
  ): Promise<O>;
  subscribe<I, O>(
    reference: FunctionReference<"query", I, O>,
    input: I,
    listener: (value: O) => void,
    options?: {
      onError?: (error: StorageError) => void;
      onStatus?: (status: "connecting" | "ready" | "reconnecting") => void;
    },
  ): () => void;
}
export interface StorageClientOptions {
  /** Host SDK callback. Called again before token expiry and after authentication failures. */
  getSession: (options: { refresh: boolean }) => Promise<StorageSession>;
  fetch?: typeof fetch;
  retryDelayMs?: number;
}
/** Host-owned transport. Sandboxed app code uses the bridge client instead. */
export function createStorageClient(options: StorageClientOptions): StorageClient {
  let cached: StorageSession | undefined;
  let pending: Promise<StorageSession> | undefined;
  function session(refresh = false): Promise<StorageSession> {
    if (refresh) {
      cached = undefined;
    }
    if (cached && cached.expiresAt > Date.now() + 5000) {
      return Promise.resolve(cached);
    }
    pending ??= options
      .getSession({ refresh })
      .then((value) => {
        cached = value;
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  async function rpc(refresh = false) {
    const auth = await session(refresh);
    const url = new URL(auth.url);
    const client = createORPCClient(
      new RPCLink({
        origin: url.origin,
        url: url.pathname.replace(/\/$/u, "") as `/${string}`,
        fetch: async (target, init) => {
          const headers = new Headers(init.headers);
          headers.set("authorization", `Bearer ${auth.token}`);
          const response = await (options.fetch ?? fetch)(target, { ...init, headers });
          // Authentication can fail at the Worker boundary before the oRPC codec runs.
          if (response.status === 401) {
            throw new StorageError("UNAUTHORIZED", "Storage token expired or rejected");
          }
          if (response.status === 403) {
            throw new StorageError("FORBIDDEN", "Storage access denied");
          }
          if ([400, 409, 503].includes(response.status)) {
            const body: unknown = await response
              .clone()
              .json()
              .catch(() => {});
            if (body && typeof body === "object" && "code" in body) {
              throw storageError(body);
            }
          }
          return response;
        },
      }),
    ) as unknown as WireClient;
    return { client, auth };
  }
  const invocation = (
    ref: FunctionReference<"query" | "mutation", unknown, unknown>,
    input: unknown,
  ) => ({ name: ref.name, input, apiVersion: ref.apiVersion });
  async function call<T>(run: (client: WireClient) => Promise<T>) {
    try {
      const { client } = await rpc();
      return await run(client);
    } catch (error) {
      if (storageError(error).code === "UNAUTHORIZED") {
        try {
          const { client } = await rpc(true);
          return await run(client);
        } catch (retryError) {
          throw storageError(retryError);
        }
      }
      throw storageError(error);
    }
  }
  return {
    query: (ref, input) =>
      call(async (client) => {
        const result = await client.query(invocation(ref, input));
        return result.value;
      }) as Promise<never>,
    mutate(ref, input, settings) {
      // Keep this ID over auth/network retries, and allow callers to persist it after an ambiguous response.
      const requestId = settings?.requestId ?? crypto.randomUUID();
      return call((client) =>
        client.mutate({ ...invocation(ref, input), requestId }),
      ) as Promise<never>;
    },
    subscribe(ref, input, listener, settings = {}) {
      const controller = new AbortController();
      let renewal: ReturnType<typeof setTimeout> | undefined;
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
      let current: AbortController | undefined;
      const retryDelay = options.retryDelayMs ?? 1000;
      let connected = false;
      let refresh = false;
      const run = async () => {
        while (!controller.signal.aborted) {
          current = new AbortController();
          settings.onStatus?.(connected ? "reconnecting" : "connecting");
          try {
            const { client, auth } = await rpc(refresh);
            refresh = false;
            if (controller.signal.aborted) {
              return;
            }
            renewal = setTimeout(
              // Renewal intentionally updates state consumed by the next reconnect iteration.
              // eslint-disable-next-line no-loop-func
              () => {
                refresh = true;
                current?.abort();
              },
              Math.max(1, auth.expiresAt - Date.now() - 2000),
            );
            const stream = await client.subscribe(invocation(ref, input), {
              signal: current.signal,
            });
            for await (const event of stream) {
              if (controller.signal.aborted || current.signal.aborted) {
                break;
              }
              listener(event.value as never);
              connected = true;
              settings.onStatus?.("ready");
            }
          } catch (error) {
            if (!controller.signal.aborted && !current.signal.aborted) {
              const failure = storageError(error);
              if (failure.code === "UNAUTHORIZED") {
                refresh = true;
              } else if (
                ["INCOMPATIBLE_VERSION", "FORBIDDEN", "BAD_REQUEST", "NOT_FOUND"].includes(
                  failure.code,
                )
              ) {
                settings.onError?.(failure);
                return;
              } else {
                settings.onError?.(failure);
              }
            }
          } finally {
            clearTimeout(renewal);
            current.abort();
          }
          if (!controller.signal.aborted) {
            settings.onStatus?.("reconnecting");
            // Each wait finishes before the next iteration; timers share subscription cleanup state.
            // eslint-disable-next-line no-loop-func
            await new Promise<void>((resolve) => {
              const abort = () => {
                clearTimeout(reconnectTimer);
                resolve();
              };
              reconnectTimer = setTimeout(
                () => {
                  controller.signal.removeEventListener("abort", abort);
                  resolve();
                },
                refresh ? 0 : retryDelay,
              );
              controller.signal.addEventListener("abort", abort, { once: true });
            });
          }
        }
      };
      void run().catch((error) => settings.onError?.(storageError(error)));
      return () => {
        controller.abort();
        current?.abort();
        clearTimeout(renewal);
      };
    },
  };
}
