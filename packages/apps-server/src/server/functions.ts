import type { Reference } from "../client/reference";
import type { z } from "zod";
import type { QueryDatabase, MutationDatabase } from "../database/types";

export interface Identity {
  readonly userId: string;
  readonly projectId: string;
  readonly appId: string;
  readonly installationId: string;
  readonly deploymentId: string;
  readonly expiresAt: number;
}

export type FunctionKind = "query" | "mutation" | "action";
export interface ActionContext {
  readonly identity: Identity;
  readonly signal: AbortSignal;
  runQuery<I, O>(reference: Reference<"query", I, O>, args: I): Promise<O>;
  runMutation<I, O>(
    reference: Reference<"mutation", I, O>,
    args: I,
    options?: { requestId?: string },
  ): Promise<O>;
}

export interface FunctionDefinition<K extends FunctionKind, A extends z.ZodType, O> {
  readonly kind: K;
  readonly args: A;
  readonly result?: z.ZodType<O>;
  readonly handler: (
    context: { args: z.output<A> } & (K extends "action"
      ? ActionContext
      : { db: K extends "query" ? QueryDatabase : MutationDatabase; identity: Identity }),
  ) => K extends "action" ? O | Promise<O> : O;
}

export function query<A extends z.ZodType, O>(
  definition: Omit<FunctionDefinition<"query", A, O>, "kind"> & {
    handler: FunctionDefinition<"query", A, O>["handler"] &
      ([O] extends [never] ? unknown : O extends PromiseLike<unknown> ? never : unknown);
  },
) {
  return Object.freeze({ ...definition, kind: "query" as const });
}
export function mutation<A extends z.ZodType, O>(
  definition: Omit<FunctionDefinition<"mutation", A, O>, "kind"> & {
    handler: FunctionDefinition<"mutation", A, O>["handler"] &
      ([O] extends [never] ? unknown : O extends PromiseLike<unknown> ? never : unknown);
  },
) {
  return Object.freeze({ ...definition, kind: "mutation" as const });
}

export function action<A extends z.ZodType, O>(
  definition: Omit<FunctionDefinition<"action", A, O>, "kind">,
) {
  return Object.freeze({ ...definition, kind: "action" as const });
}

// Erasure is private to dispatch; the generic definitions preserve app argument/result types.
export type Functions = Record<
  string,
  {
    kind: FunctionKind;
    args: z.ZodType;
    result?: z.ZodType;
    handler: (context: never) => unknown;
  }
>;
export function defineApp<const F extends Functions>(functions: F) {
  for (const name of Object.keys(functions))
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(name)) throw new Error("Invalid function name");
  return Object.freeze({ functions });
}
export type AppDefinition = ReturnType<typeof defineApp>;
