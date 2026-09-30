import { StorageError } from "@tailorkit/app-storage";
import type { StorageClient } from "@tailorkit/app-storage";
import type { StorageBridgeRequest, StorageBridgeResult } from "../protocol";

export function createIframeStorage(send: (data: StorageBridgeRequest) => void) {
  const pending = new Map<string, (result: StorageBridgeResult) => void>();
  const cleanups = new Set<() => void>();
  let closed = false;
  const error = (result: StorageBridgeResult) =>
    new StorageError(
      (result.error?.code ?? "INTERNAL_SERVER_ERROR") as StorageError["code"],
      result.error?.message,
    );
  const call = (data: Omit<StorageBridgeRequest, "id">) =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) {
        reject(new StorageError("UNAVAILABLE", "Sandbox was destroyed"));
        return;
      }
      const id = crypto.randomUUID();
      const cleanup = () => {
        clearTimeout(timer);
        pending.delete(id);
        cleanups.delete(dispose);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new StorageError("UNAVAILABLE", "Storage bridge timed out"));
      }, 30_000);
      const dispose = () => {
        cleanup();
        reject(new StorageError("UNAVAILABLE", "Sandbox was destroyed"));
      };
      cleanups.add(dispose);
      pending.set(id, (result) => {
        cleanup();
        if (result.error) {
          reject(error(result));
        } else {
          resolve(result.value);
        }
      });
      send({ ...data, id });
    });
  const client: StorageClient = {
    query: (reference, input) =>
      call({
        name: reference.name,
        apiVersion: reference.apiVersion,
        input,
        op: "query",
      }) as Promise<never>,
    mutate: (reference, input, options) =>
      call({
        name: reference.name,
        apiVersion: reference.apiVersion,
        input,
        op: "mutate",
        requestId: options?.requestId ?? crypto.randomUUID(),
      }) as Promise<never>,
    subscribe(reference, input, listener, options = {}) {
      if (closed) {
        throw new StorageError("UNAVAILABLE", "Sandbox was destroyed");
      }
      const id = crypto.randomUUID();
      const stop = () => {
        if (!pending.delete(id)) {
          return;
        }
        cleanups.delete(stop);
        send({
          name: reference.name,
          apiVersion: reference.apiVersion,
          input: null,
          id,
          op: "cancel",
        });
      };
      cleanups.add(stop);
      pending.set(id, (result) => {
        if (result.error) {
          options.onError?.(error(result));
        } else if (result.status) {
          options.onStatus?.(result.status);
        } else {
          listener(result.value as never);
        }
      });
      send({ name: reference.name, apiVersion: reference.apiVersion, input, id, op: "subscribe" });
      return stop;
    },
  };
  return {
    client,
    receive(result: StorageBridgeResult) {
      pending.get(result.id)?.(result);
    },
    close() {
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.clear();
      pending.clear();
      closed = true;
    },
  };
}
