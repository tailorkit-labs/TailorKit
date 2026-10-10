import type { ToolBridge, Session } from "@tailorkit/app/client";
export function createIframeTools(
  send: (input: { id: string; kind: "client" | "server"; path: string; input?: unknown }) => void,
) {
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let closed = false;
  function request(kind: "client" | "server", path: string, input?: unknown): Promise<unknown> {
    if (closed) return Promise.reject(new Error("Sandbox destroyed"));
    if (pending.size >= 32) return Promise.reject(new Error("Too many pending tool requests"));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Tool request timed out"));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      send({ id, kind, path, input });
    });
  }
  const bridge: ToolBridge = {
    client: (path, input) => request("client", path, input),
    session: (path) => request("server", path) as Promise<Session>,
  };
  return {
    bridge,
    receive(result: { id: string; output?: unknown; error?: string }) {
      const entry = pending.get(result.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(result.id);
      if (result.error) entry.reject(new Error(result.error));
      else entry.resolve(result.output);
    },
    close() {
      closed = true;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Sandbox destroyed"));
      }
      pending.clear();
    },
  };
}
