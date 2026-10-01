import type { Session } from "@tailorkit/apps-server/client";

/** The bridge only supplies scoped JWTs. Backend RPC traffic goes directly over WebSocket. */
export function createIframeBackend(send: (request: { id: string; refresh: boolean }) => void) {
  const pending = new Map<
    string,
    {
      resolve(value: Session): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let closed = false;
  return {
    getSession(input: { refresh: boolean }): Promise<Session> {
      if (closed) return Promise.reject(new Error("Sandbox was destroyed"));
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("JWT bridge timed out"));
        }, 30_000);
        pending.set(id, { resolve, reject, timer });
        send({ id, refresh: input.refresh });
      });
    },
    receive(result: { id: string; session?: Session; error?: string }) {
      const request = pending.get(result.id);
      if (!request) return;
      pending.delete(result.id);
      clearTimeout(request.timer);
      if (result.session) request.resolve(result.session);
      else request.reject(new Error(result.error ?? "Unable to authorize the app backend"));
    },
    close() {
      closed = true;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Sandbox was destroyed"));
      }
      pending.clear();
    },
  };
}
