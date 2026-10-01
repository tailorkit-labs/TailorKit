import type { KV } from "@tailorkit/kv";
import { Effect } from "effect";
import { PreviewStorageError } from "./errors";

/** Keep adapter I/O lazy and put failures in the Effect error channel. */
function operation<Args extends unknown[], Result>(
  name: string,
  run: (...args: Args) => Promise<Result>,
) {
  return (...args: Args) =>
    Effect.tryPromise({
      try: () => run(...args),
      catch: (cause) => new PreviewStorageError({ operation: name, cause }),
    });
}

export function createPreviewStorage(kv: KV) {
  return {
    get: operation("get", (...args: Parameters<KV["get"]>) => kv.get(...args)),
    set: operation("set", (...args: Parameters<KV["set"]>) => kv.set(...args)),
    delete: operation("delete", (...args: Parameters<KV["delete"]>) => kv.delete(...args)),
    increment: operation("increment", (...args: Parameters<KV["increment"]>) =>
      kv.increment(...args),
    ),
    claimUpload: operation("claimUpload", (...args: Parameters<KV["claimUpload"]>) =>
      kv.claimUpload(...args),
    ),
    promoteIfOwnerAndNewer: operation(
      "promoteIfOwnerAndNewer",
      (...args: Parameters<KV["promoteIfOwnerAndNewer"]>) => kv.promoteIfOwnerAndNewer(...args),
    ),
    publish: operation("publish", (...args: Parameters<KV["publish"]>) => kv.publish(...args)),
    subscribe: operation("subscribe", (...args: Parameters<KV["subscribe"]>) =>
      kv.subscribe(...args),
    ),
  };
}
