import type { z } from "zod";
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations";
import type { DatabaseDefinition } from "../database/definition";
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
export type FunctionResult<D> = D extends { result: infer R extends z.ZodType }
  ? z.output<R>
  : D extends { handler: (context: never) => infer O }
    ? Awaited<O>
    : never;
export type FunctionCalls<F, K extends "query" | "mutation"> = {
  readonly [
    N in keyof F as F[N] extends { kind: FunctionKind } ? (F[N] extends { kind: K } ? N : never) : N
  ]: F[N] extends {
    args: infer A extends z.ZodType;
    handler: (context: never) => unknown;
  }
    ? K extends "mutation"
      ? (
          ...args: undefined extends z.input<A>
            ? [args?: z.input<A>, options?: { requestId?: string }]
            : [args: z.input<A>, options?: { requestId?: string }]
        ) => Promise<FunctionResult<F[N]>>
      : (
          ...args: undefined extends z.input<A> ? [args?: z.input<A>] : [args: z.input<A>]
        ) => Promise<FunctionResult<F[N]>>
    : F[N] extends Functions
      ? FunctionCalls<F[N], K>
      : never;
};
export interface ActionContext<F extends Functions = Record<never, never>> {
  readonly identity: Identity;
  readonly signal: AbortSignal;
  readonly queries: FunctionCalls<F, "query">;
  readonly mutations: FunctionCalls<F, "mutation">;
}

export interface FunctionDefinition<
  K extends FunctionKind,
  A extends z.ZodType,
  O,
  F extends Functions = Record<never, never>,
  D extends AnyRelations = EmptyRelations,
> {
  readonly kind: K;
  readonly args: A;
  readonly database?: K extends "action" ? never : DatabaseDefinition<D>;
  readonly result?: z.ZodType<O>;
  readonly handler: (
    context: { args: z.output<A> } & (K extends "action"
      ? ActionContext<F>
      : { db: K extends "query" ? QueryDatabase<D> : MutationDatabase<D>; identity: Identity }),
  ) => K extends "action" ? O | Promise<O> : O;
}

export function query<A extends z.ZodType, O, const D extends AnyRelations = EmptyRelations>(
  definition: Omit<FunctionDefinition<"query", A, O, Record<never, never>, D>, "kind"> & {
    handler: FunctionDefinition<"query", A, O, Record<never, never>, D>["handler"] &
      ([O] extends [never] ? unknown : O extends PromiseLike<unknown> ? never : unknown);
  },
) {
  return Object.freeze({ ...definition, kind: "query" as const });
}
export function mutation<A extends z.ZodType, O, const D extends AnyRelations = EmptyRelations>(
  definition: Omit<FunctionDefinition<"mutation", A, O, Record<never, never>, D>, "kind"> & {
    handler: FunctionDefinition<"mutation", A, O, Record<never, never>, D>["handler"] &
      ([O] extends [never] ? unknown : O extends PromiseLike<unknown> ? never : unknown);
  },
) {
  return Object.freeze({ ...definition, kind: "mutation" as const });
}

export function action<A extends z.ZodType, O, const F extends Functions = Record<never, never>>(
  definition: Omit<FunctionDefinition<"action", A, O, F>, "kind"> & { functions?: F },
) {
  return Object.freeze({ ...definition, kind: "action" as const });
}

// Erasure is private to dispatch; the generic definitions preserve app argument/result types.
export type RegisteredFunction = {
  kind: FunctionKind;
  args: z.ZodType;
  result?: z.ZodType;
  handler: (context: never) => unknown;
  functions?: Functions;
  database?: DatabaseDefinition;
};
export interface Functions {
  readonly [name: string]: RegisteredFunction | Functions;
}

export function isFunction(value: RegisteredFunction | Functions): value is RegisteredFunction {
  return typeof value.kind === "string" && typeof value.handler === "function";
}

export function defineServer<const F extends Functions>(functions: F) {
  for (const [name, value] of Object.entries(functions)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(name)) {
      throw new Error("Invalid function name");
    }
    if (!isFunction(value)) defineServer(value);
  }
  return Object.freeze({ functions });
}
export type AppDefinition = ReturnType<typeof defineServer>;
