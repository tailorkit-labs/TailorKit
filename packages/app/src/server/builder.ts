import { z } from "zod";
import type { MutationDatabase, QueryDatabase } from "../database/types";
import type { ActionContext, FunctionKind, Functions, Identity } from "./functions";

type HandlerContext<K extends FunctionKind, A extends z.ZodType, F extends Functions> = {
  input: z.output<A>;
} & (K extends "action"
  ? ActionContext<F>
  : { db: K extends "query" ? QueryDatabase : MutationDatabase; identity: Identity });

type OutputInput<R> = R extends z.ZodType ? z.input<R> : unknown;
type HandlerOutput<K, O> = K extends "action"
  ? O | Promise<O>
  : O & ([O] extends [never] ? unknown : O extends PromiseLike<unknown> ? never : unknown);

type BuiltFunction<K extends FunctionKind, A extends z.ZodType, R, O, F extends Functions> = {
  readonly kind: K;
  readonly args: A;
  readonly handler: (
    context: Omit<HandlerContext<K, A, F>, "input"> & { args: z.output<A> },
  ) => HandlerOutput<K, O>;
} & (R extends z.ZodType ? { readonly result: R } : unknown) &
  (K extends "action" ? { readonly functions: F } : unknown);

/** Immutable builders preserve the validated input and wire output types at every step. */
class FunctionBuilder<
  K extends FunctionKind,
  A extends z.ZodType,
  R extends z.ZodType | undefined = undefined,
  F extends Functions = Record<never, never>,
> {
  private readonly kind: K;
  private readonly args: A;
  private readonly result: R;
  private readonly calls: F;

  constructor(kind: K, args: A, result: R, calls: F) {
    this.kind = kind;
    this.args = args;
    this.result = result;
    this.calls = calls;
  }

  input<S extends z.ZodType>(schema: S) {
    return new FunctionBuilder(this.kind, schema, this.result, this.calls);
  }

  output<S extends z.ZodType>(schema: S) {
    return new FunctionBuilder(this.kind, this.args, schema, this.calls);
  }

  functions<const G extends Functions>(this: FunctionBuilder<"action", A, R, F>, functions: G) {
    return new FunctionBuilder(this.kind, this.args, this.result, functions);
  }

  handler<O extends OutputInput<R>>(
    handler: (context: HandlerContext<K, A, F>) => HandlerOutput<K, O>,
  ): BuiltFunction<K, A, R, O, F> {
    return Object.freeze({
      kind: this.kind,
      args: this.args,
      ...(this.result ? { result: this.result } : {}),
      ...(this.kind === "action" ? { functions: this.calls } : {}),
      handler: (context: Omit<HandlerContext<K, A, F>, "input"> & { args: z.output<A> }) =>
        handler({ ...context, input: context.args } as unknown as HandlerContext<K, A, F>),
    }) as BuiltFunction<K, A, R, O, F>;
  }
}

export const tk = Object.freeze({
  query: new FunctionBuilder("query", z.undefined(), undefined, {}),
  mutation: new FunctionBuilder("mutation", z.undefined(), undefined, {}),
  action: new FunctionBuilder("action", z.undefined(), undefined, {}),
});
