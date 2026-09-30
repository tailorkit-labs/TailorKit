import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ReadDatabase, StoreSchema, WriteDatabase } from "./schema";

export { defineSchema, fields } from "./schema";
export type { Row, StoreSchema, ReadDatabase, WriteDatabase } from "./schema";
export { StorageError } from "./errors";
export type { References } from "./reference";
export interface StorageIdentity {
  readonly userId: string;
  readonly appId: string;
  readonly installationId: string;
  readonly expiresAt: number;
}
export interface FunctionDefinition<
  K extends "query" | "mutation",
  S extends StoreSchema,
  I extends StandardSchemaV1,
  O extends StandardSchemaV1,
> {
  readonly kind: K;
  readonly input: I;
  readonly output: O;
  readonly handler: (
    context: {
      db: K extends "query" ? ReadDatabase<S> : WriteDatabase<S>;
      identity: StorageIdentity;
    },
    input: StandardSchemaV1.InferOutput<I>,
  ) => StandardSchemaV1.InferInput<O>;
}
/** Handlers and validators must be synchronous to preserve SQLite transaction isolation. */
export function createFunctions<S extends StoreSchema>(_schema: S) {
  function define<K extends "query" | "mutation">(kind: K) {
    return <I extends StandardSchemaV1, O extends StandardSchemaV1>(
      definition: Omit<FunctionDefinition<K, S, I, O>, "kind">,
    ): FunctionDefinition<K, S, I, O> => Object.freeze({ ...definition, kind });
  }
  return { query: define("query"), mutation: define("mutation") };
}
// Erased internally; the inferred app type retains each validator and handler signature.
export interface StoreDefinition<S extends StoreSchema = StoreSchema, F = unknown> {
  readonly schema: S;
  /** Bump for breaking API changes. Old clients fail explicitly instead of running mismatched code. */
  readonly apiVersion: number;
  readonly functions: F;
}
export function defineStore<const S extends StoreSchema, const F>(
  store: StoreDefinition<S, F>,
): StoreDefinition<S, F> {
  if (!Number.isSafeInteger(store.apiVersion) || store.apiVersion < 1) {
    throw new Error("Invalid API version");
  }
  for (const [name, fn] of Object.entries(store.functions as Record<string, { kind?: string }>)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(name) ||
      !["query", "mutation"].includes(fn.kind ?? "")
    ) {
      throw new Error(`Invalid storage function: ${name}`);
    }
  }
  return Object.freeze({ ...store, functions: Object.freeze(store.functions) });
}
