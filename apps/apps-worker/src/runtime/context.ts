import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "./errors";
import type { FunctionKind } from "@tailorkit/app/server";

export interface ExecutionContext {
  kind: FunctionKind;
  signal?: AbortSignal;
  active: boolean;
  fetch?: typeof globalThis.fetch;
}

const context = new AsyncLocalStorage<ExecutionContext>();

/** Install only in the untrusted runtime, before importing application modules. */
export function installFetchGuard() {
  globalThis.fetch = (input, init) => {
    const current = context.getStore();
    if (current?.kind !== "action") {
      throw new AppError("FORBIDDEN", "fetch is only available inside actions");
    }
    if (!current.active || current.signal?.aborted) {
      throw new AppError("UNAVAILABLE", "Action has ended");
    }
    if (!current.fetch) {
      throw new AppError("UNAVAILABLE", "Action fetch is unavailable");
    }
    return current.fetch(input, init);
  };
}

export function inExecutionContext<A>(scope: ExecutionContext, run: () => A): A {
  return context.run(scope, run);
}
