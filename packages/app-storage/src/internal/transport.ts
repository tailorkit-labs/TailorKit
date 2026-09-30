import { asyncIteratorObject, ORPCError, os } from "@orpc/server";
import { RPCHandler, BodyLimitPlugin } from "@orpc/server/fetch";
import { z } from "zod";
import { StorageError } from "../errors";
import type { StorageIdentity } from "../server";
import type { Snapshot, StorageRuntime } from "./runtime";

const invocation = z.strictObject({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u),
  input: z.unknown(),
  apiVersion: z.number().int().positive(),
});
const snapshot = z.object({ value: z.unknown(), revision: z.number().int().nonnegative() });
function wire<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof StorageError) {
      throw new ORPCError(error.code, { message: error.message });
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR");
  }
}
export function storageRpcHandler(runtime: StorageRuntime) {
  const o = os.$context<{ identity: StorageIdentity; signal: AbortSignal }>();
  return new RPCHandler(
    {
      query: o
        .input(invocation)
        .output(snapshot)
        .handler(({ input, context }) =>
          wire(() => {
            const result = runtime.query(input, context.identity);
            return { value: result.value, revision: result.revision };
          }),
        ),
      mutate: o
        .input(invocation.extend({ requestId: z.uuid() }))
        .output(z.unknown())
        .handler(({ input, context }) => wire(() => runtime.mutate(input, context.identity))),
      subscribe: o
        .input(invocation)
        .output(asyncIteratorObject(snapshot))
        .handler(({ input, context }) => {
          const stream = wire(() => runtime.subscribe(input, context.identity, context.signal));
          // Return an iterator object, registering before the transport yields its initial response.
          const wireStream: AsyncIteratorObject<Snapshot> = {
            [Symbol.asyncIterator]() {
              return this;
            },
            [Symbol.asyncDispose]: async () => {
              await stream.return?.();
            },
            next: () =>
              stream.next().catch((error) =>
                wire(() => {
                  throw error;
                }),
              ),
            return: () =>
              stream.return?.() ?? Promise.resolve({ done: true as const, value: undefined }),
          };
          return wireStream;
        }),
    },
    {
      errorStatusMap: { INCOMPATIBLE_VERSION: 409, UNAVAILABLE: 503 },
      plugins: [new BodyLimitPlugin({ maxBodySize: 1024 * 1024 })],
    },
  );
}
