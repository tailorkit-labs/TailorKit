import type { z } from "zod";

export interface Reference<K extends "query" | "mutation" | "action", I, O> {
  readonly name: string;
  readonly $types?: { kind: K; input: I; output: O };
}
export function reference<K extends "query" | "mutation" | "action", I, O>(
  name: string,
  _kind: K,
): Reference<K, I, O> {
  return Object.freeze({ name });
}
export type References<F> = {
  readonly [N in keyof F]: F[N] extends {
    kind: infer K extends "query" | "mutation" | "action";
    args: infer A extends z.ZodType;
    handler: (...args: never[]) => infer O;
  }
    ? Reference<K, z.input<A>, Awaited<O>>
    : never;
};
