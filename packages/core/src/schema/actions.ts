import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { TailorKitSchemaSpec } from "../spec/index";
import type { InferSchema, MaybePromise, Schema, SchemaSerializer } from "./shared";
import { serializeSchema } from "./shared";

type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

type IsUnion<TValue, TCompare = TValue> = [TValue] extends [never]
  ? false
  : TValue extends unknown
    ? [TCompare] extends [TValue]
      ? false
      : true
    : false;

export interface ActionDefinition<
  TInput extends Schema | undefined = Schema | undefined,
  TOutput extends Schema | undefined = Schema | undefined,
> {
  input?: TInput;
  output?: TOutput;
}

export interface HandlerArgs<TInput extends Schema | undefined, TActionContext> {
  context: TActionContext;
  input: TInput extends Schema ? StandardSchemaV1.InferOutput<TInput> : undefined;
}

export type ActionHandler<
  TInput extends Schema | undefined,
  TOutput extends Schema | undefined,
  TActionContext,
  TReturn = TOutput extends Schema ? StandardSchemaV1.InferOutput<TOutput> : unknown,
> = {
  bivarianceHack(options: HandlerArgs<TInput, TActionContext>): MaybePromise<TReturn>;
}["bivarianceHack"];

export interface ImplementedAction<
  TInput extends Schema | undefined = Schema | undefined,
  TOutput extends Schema | undefined = Schema | undefined,
  TActionContext = unknown,
  TReturn = TOutput extends Schema ? StandardSchemaV1.InferOutput<TOutput> : unknown,
> {
  $tailorkitAction: true;
  definition: ActionDefinition<TInput, TOutput>;
  handler: ActionHandler<TInput, TOutput, TActionContext, TReturn>;
}

export interface ActionTree<TActionContext = unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: ImplementedAction<any, any, any, any> | ActionTree<TActionContext> | undefined;
}

type InferActionLeafContext<TAction> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TAction extends ImplementedAction<any, any, infer TActionContext, any> ? TActionContext : never;

export type InferActionTreeContext<TActions> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TActions extends ImplementedAction<any, any, infer TActionContext, any>
    ? TActionContext
    : TActions extends Record<string, unknown>
      ? {
          [TKey in keyof TActions]: InferActionTreeContext<NonNullable<TActions[TKey]>>;
        }[keyof TActions]
      : never;

type HasNoActions<TActions> = [InferActionTreeContext<TActions>] extends [never] ? true : false;

export type ResolveActionTreeContext<TActions> =
  HasNoActions<TActions> extends true
    ? never
    : UnionToIntersection<InferActionTreeContext<TActions>>;

type MixedActionContextKeys<TActions> =
  TActions extends Record<string, unknown>
    ? {
        [TKey in keyof TActions]: IsUnion<
          InferActionLeafContext<NonNullable<TActions[TKey]>>
        > extends true
          ? TKey
          : NonNullable<TActions[TKey]> extends Record<string, unknown>
            ? MixedActionContextKeys<NonNullable<TActions[TKey]>>
            : never;
      }[keyof TActions]
    : never;

export type NoMixedActionContexts<TActions> =
  IsUnion<InferActionTreeContext<TActions>> extends true
    ? {
        readonly __tailorkit_error__: "All actions in a TailorKit instance must use the same context type.";
      }
    : MixedActionContextKeys<TActions> extends never
      ? unknown
      : {
          readonly __tailorkit_error__: "All actions in a TailorKit instance must use the same context type.";
        };

export type ActionDefinitions = ActionTree;

export type InferActionInput<TAction> = TAction extends { definition: { input?: infer TInput } }
  ? TInput extends Schema
    ? InferSchema<TInput>
    : undefined
  : TAction extends ActionDefinition<infer TInput, Schema | undefined>
    ? TInput extends Schema
      ? InferSchema<TInput>
      : undefined
    : never;

export type InferActionOutput<TAction> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TAction extends ImplementedAction<any, infer TOutput, any, infer TReturn>
    ? [TOutput] extends [never]
      ? Awaited<TReturn>
      : [TOutput] extends [Schema]
        ? InferSchema<TOutput>
        : Awaited<TReturn>
    : TAction extends {
          definition: { output?: infer TOutput };
          handler: (...args: never[]) => infer TReturn;
        }
      ? [TOutput] extends [never]
        ? Awaited<TReturn>
        : [TOutput] extends [Schema]
          ? InferSchema<TOutput>
          : Awaited<TReturn>
      : TAction extends { definition: { output?: infer TOutput } }
        ? TOutput extends Schema
          ? InferSchema<TOutput>
          : void
        : TAction extends ActionDefinition<Schema | undefined, infer TOutput>
          ? TOutput extends Schema
            ? InferSchema<TOutput>
            : void
          : never;

interface ActionBuilder<
  TInput extends Schema | undefined = undefined,
  TOutput extends Schema | undefined = undefined,
  TActionContext = never,
> {
  context: <TNextActionContext>() => ActionBuilder<TInput, TOutput, TNextActionContext>;
  handler: <
    TReturn extends (TOutput extends Schema ? StandardSchemaV1.InferOutput<TOutput> : unknown) =
      TOutput extends Schema ? StandardSchemaV1.InferOutput<TOutput> : unknown,
  >(
    handler: ActionHandler<TInput, TOutput, TActionContext, TReturn>,
  ) => ImplementedAction<TInput, TOutput, TActionContext, TReturn>;
  input: <const TNextInput extends Schema>(
    input: TNextInput,
  ) => ActionBuilder<TNextInput, TOutput, TActionContext>;
  output: <const TNextOutput extends Schema>(
    output: TNextOutput,
  ) => ActionBuilder<TInput, TNextOutput, TActionContext>;
}

const createActionBuilder = <
  TInput extends Schema | undefined = undefined,
  TOutput extends Schema | undefined = undefined,
  TActionContext = never,
>(
  inputSchema?: TInput,
  outputSchema?: TOutput,
): ActionBuilder<TInput, TOutput, TActionContext> => ({
  context: <TNextActionContext>() =>
    createActionBuilder<TInput, TOutput, TNextActionContext>(inputSchema, outputSchema),
  handler: (handler) => ({
    $tailorkitAction: true,
    definition: { input: inputSchema, output: outputSchema },
    handler,
  }),
  input: <const TNextInput extends Schema>(input: TNextInput) =>
    createActionBuilder<TNextInput, TOutput, TActionContext>(input, outputSchema),
  output: <const TNextOutput extends Schema>(output: TNextOutput) =>
    createActionBuilder<TInput, TNextOutput, TActionContext>(inputSchema, output),
});

export const createActions = () => createActionBuilder();

export const serializeActions = (
  actions: ActionTree,
  schemaSerializer?: SchemaSerializer,
): TailorKitSchemaSpec["actions"] => {
  const serialized: NonNullable<TailorKitSchemaSpec["actions"]> = {};

  for (const [name, definition] of Object.entries(actions)) {
    if (definition === undefined) {
      continue;
    }

    if ("$tailorkitAction" in definition) {
      const actionDefinition = (definition as ImplementedAction).definition;
      serialized[name] = {
        input: serializeSchema(actionDefinition.input, schemaSerializer, "input"),
        output: serializeSchema(actionDefinition.output, schemaSerializer),
      };
    } else {
      serialized[name] = serializeActions(definition as ActionTree, schemaSerializer);
    }
  }

  return serialized;
};

export type Action = ImplementedAction;
export type Actions = ActionDefinitions;
