import { z } from "zod";
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations";
import type { DatabaseDefinition } from "../database/definition";
import type { MutationDatabase, QueryDatabase } from "../database/types";
import type { ActionContext, FunctionKind, Functions, Identity } from "./functions";

type HandlerContext<
  K extends FunctionKind,
  A extends z.ZodType,
  F extends Functions,
  D extends AnyRelations,
> = {
  input: z.output<A>;
} & (K extends "action"
  ? ActionContext<F>
  : { db: K extends "query" ? QueryDatabase<D> : MutationDatabase<D>; identity: Identity });

type OutputInput<R> = R extends z.ZodType ? z.input<R> : unknown;
type HandlerOutput<K, O> = K extends "action"
  ? O | Promise<O>
  : O & ([O] extends [never] ? unknown : O extends PromiseLike<unknown> ? never : unknown);

type BuiltFunction<
  K extends FunctionKind,
  A extends z.ZodType,
  R,
  O,
  F extends Functions,
  D extends AnyRelations,
> = {
  readonly kind: K;
  readonly args: A;
  readonly database?: DatabaseDefinition<D>;
  readonly handler: (
    context: Omit<HandlerContext<K, A, F, D>, "input"> & { args: z.output<A> },
  ) => HandlerOutput<K, O>;
} & (R extends z.ZodType ? { readonly result: R } : unknown) &
  (K extends "action" ? { readonly functions: F } : unknown);

/** Immutable builders preserve the validated input and wire output types at every step. */
class FunctionBuilder<
  K extends FunctionKind,
  A extends z.ZodType,
  R extends z.ZodType | undefined = undefined,
  F extends Functions = Record<never, never>,
  D extends AnyRelations = EmptyRelations,
> {
  private readonly kind: K;
  private readonly args: A;
  private readonly result: R;
  private readonly calls: F;
  private readonly databaseDefinition: DatabaseDefinition<D> | undefined;

  constructor(kind: K, args: A, result: R, calls: F, database?: DatabaseDefinition<D>) {
    this.kind = kind;
    this.args = args;
    this.result = result;
    this.calls = calls;
    this.databaseDefinition = database;
  }

  input<S extends z.ZodType>(schema: S) {
    return new FunctionBuilder(this.kind, schema, this.result, this.calls, this.databaseDefinition);
  }

  output<S extends z.ZodType>(schema: S) {
    return new FunctionBuilder(this.kind, this.args, schema, this.calls, this.databaseDefinition);
  }

  functions<const G extends Functions>(this: FunctionBuilder<"action", A, R, F, D>, functions: G) {
    return new FunctionBuilder(
      this.kind,
      this.args,
      this.result,
      functions,
      this.databaseDefinition,
    );
  }

  database<const E extends AnyRelations>(
    this: FunctionBuilder<K, A, R, F, D> & (K extends "action" ? never : unknown),
    database: DatabaseDefinition<E>,
  ) {
    return new FunctionBuilder<K, A, R, F, E>(
      this.kind,
      this.args,
      this.result,
      this.calls,
      database,
    );
  }

  handler<O extends OutputInput<R>>(
    handler: (context: HandlerContext<K, A, F, D>) => HandlerOutput<K, O>,
  ): BuiltFunction<K, A, R, O, F, D> {
    return Object.freeze({
      kind: this.kind,
      args: this.args,
      ...(this.databaseDefinition ? { database: this.databaseDefinition } : {}),
      ...(this.result ? { result: this.result } : {}),
      ...(this.kind === "action" ? { functions: this.calls } : {}),
      handler: (context: Omit<HandlerContext<K, A, F, D>, "input"> & { args: z.output<A> }) =>
        handler({ ...context, input: context.args } as unknown as HandlerContext<K, A, F, D>),
    }) as BuiltFunction<K, A, R, O, F, D>;
  }
}

export const tk = Object.freeze({
  query: new FunctionBuilder("query", z.undefined(), undefined, {}),
  mutation: new FunctionBuilder("mutation", z.undefined(), undefined, {}),
  action: new FunctionBuilder("action", z.undefined(), undefined, {}),
});
