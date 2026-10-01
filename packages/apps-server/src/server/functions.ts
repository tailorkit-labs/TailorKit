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

export interface FunctionDefinition<K extends "query" | "mutation", A extends z.ZodType, O> {
  readonly kind: K;
  readonly args: A;
  readonly result?: z.ZodType<O>;
  readonly handler: (context: {
    args: z.output<A>;
    db: K extends "query" ? QueryDatabase : MutationDatabase;
    identity: Identity;
  }) => O;
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

// Erasure is private to dispatch; the generic definitions preserve app argument/result types.
export type Functions = Record<
  string,
  {
    kind: "query" | "mutation";
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
