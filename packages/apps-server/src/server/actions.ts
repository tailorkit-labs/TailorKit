import type { AppDefinition, Identity } from "./functions";
import type { Invocation } from "./execution";
import { AppError } from "../errors";

/** Provider callbacks carry a trusted identity; actions receive no database handle. */
export interface ActionCalls {
  query(input: Invocation): Promise<unknown>;
  mutate(input: Invocation & { requestId: string }): Promise<unknown>;
}

export function createActionExecution(app: AppDefinition, calls: ActionCalls) {
  return async (input: Invocation, identity: Identity, signal = new AbortController().signal) => {
    let active = true;
    function check() {
      if (!active || signal.aborted) throw new AppError("UNAVAILABLE", "Action has ended");
      if (identity.expiresAt <= Date.now()) throw new AppError("UNAUTHORIZED", "App token expired");
    }
    check();
    const fn = app.functions[input.name];
    if (!fn || fn.kind !== "action") throw new AppError("NOT_FOUND", "App action not found");
    const parsed = fn.args.safeParse(input.args);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid function arguments");
    try {
      let value = await fn.handler({
        args: parsed.data,
        identity,
        signal,
        runQuery: (reference: { name: string }, args: unknown) => {
          check();
          return calls.query({ name: reference.name, args });
        },
        runMutation: (
          reference: { name: string },
          args: unknown,
          options?: { requestId?: string },
        ) => {
          check();
          return calls.mutate({
            name: reference.name,
            args,
            requestId: options?.requestId ?? crypto.randomUUID(),
          });
        },
      } as never);
      check();
      if (fn.result) {
        const result = fn.result.safeParse(value);
        if (!result.success) throw new AppError("INTERNAL_SERVER_ERROR", "Invalid function result");
        value = result.data;
      }
      const serialized = JSON.stringify(value ?? null);
      if (new TextEncoder().encode(serialized).byteLength + 64 > 1024 * 1024)
        throw new AppError("BAD_REQUEST", "Function result exceeds 1 MiB");
      return JSON.parse(serialized) as unknown;
    } finally {
      active = false;
    }
  };
}
