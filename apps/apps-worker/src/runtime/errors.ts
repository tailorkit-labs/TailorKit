import { Effect } from "effect";
import { appError } from "@tailorkit/app/client";
import type { AppError } from "@tailorkit/app/client";

export { AppError, appError } from "@tailorkit/app/client";

export type FunctionResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: ReturnType<typeof appError>["code"]; message: string } };

/** One internal RPC envelope; HTTP encoding belongs to the transport. */
export interface InvocationResult {
  result: FunctionResult;
  tables: string[];
  committed: boolean;
}

export function failedResult(error: unknown): FunctionResult {
  const failure = appError(error);
  return { ok: false, error: { code: failure.code, message: failure.message } };
}

export function resultValue(result: FunctionResult) {
  if (!result.ok) {
    throw appError(result.error);
  }
  return result.value;
}

export function resultEffect(result: FunctionResult): Effect.Effect<unknown, AppError> {
  return result.ok ? Effect.succeed(result.value) : Effect.fail(appError(result.error));
}
