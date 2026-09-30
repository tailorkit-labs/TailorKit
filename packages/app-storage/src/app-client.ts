import type { StorageClient } from "./client";
import { StorageError } from "./errors";
/** Implemented by the existing sandbox runtime, never by a credential-bearing app bundle. */
export function createAppStorageClient(): StorageClient {
  const get = () => {
    const bridge = (globalThis as typeof globalThis & { __tailorkitStorage?: StorageClient })
      .__tailorkitStorage;
    if (!bridge) {
      throw new StorageError("UNAVAILABLE", "App storage requires the TailorKit sandbox bridge");
    }
    return bridge;
  };
  return {
    query: (reference, input) => get().query(reference, input),
    mutate: (reference, input, options) => get().mutate(reference, input, options),
    subscribe: (reference, input, listener, options) =>
      get().subscribe(reference, input, listener, options),
  };
}
