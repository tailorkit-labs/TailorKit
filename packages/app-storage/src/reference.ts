import type { StandardSchemaV1 } from "@standard-schema/spec";

export interface FunctionReference<K extends "query" | "mutation", I, O> {
  readonly name: string;
  readonly kind: K;
  readonly apiVersion: number;
  /** Type-only; no server code is stored in a reference. */
  readonly $types?: { input: I; output: O };
}
export function functionReference<K extends "query" | "mutation", I, O>(
  name: string,
  kind: K,
  apiVersion: number,
): FunctionReference<K, I, O> {
  return Object.freeze({ name, kind, apiVersion });
}
export type References<F> = {
  [K in keyof F]: F[K] extends {
    kind: infer Kind extends "query" | "mutation";
    input: infer I extends StandardSchemaV1;
    output: infer O extends StandardSchemaV1;
  }
    ? FunctionReference<Kind, StandardSchemaV1.InferInput<I>, StandardSchemaV1.InferOutput<O>>
    : never;
};
