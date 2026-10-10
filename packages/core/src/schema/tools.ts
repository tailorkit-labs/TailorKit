import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { TailorKitSchemaSpec } from "../spec/index";
import type { Schema, SchemaSerializer } from "./shared";
import { serializeSchema } from "./shared";

export type ToolKind = "client" | "server";
export interface ContractTool<
  K extends ToolKind = ToolKind,
  I extends Schema | undefined = Schema | undefined,
  O extends Schema | undefined = Schema | undefined,
> {
  readonly $tailorkitToolDefinition: true;
  readonly kind: K;
  readonly definition: { input?: I; output?: O };
  input<N extends Schema>(schema: N): ContractTool<K, N, O>;
  output<N extends Schema>(schema: N): ContractTool<K, I, N>;
}
export interface ContractTools {
  [name: string]: ContractTool | ContractTools;
}
function build<K extends ToolKind, I extends Schema | undefined, O extends Schema | undefined>(
  kind: K,
  input?: I,
  output?: O,
): ContractTool<K, I, O> {
  return {
    $tailorkitToolDefinition: true,
    kind,
    definition: { input, output },
    input: (schema) => build(kind, schema, output),
    output: (schema) => build(kind, input, schema),
  };
}
export const tool = {
  client: () => build<"client", undefined, undefined>("client"),
  server: () => build<"server", undefined, undefined>("server"),
};
export type InferToolInput<T> =
  T extends ContractTool<ToolKind, infer I, Schema | undefined>
    ? I extends Schema
      ? StandardSchemaV1.InferInput<I>
      : undefined
    : never;
export type InferToolOutput<T> =
  T extends ContractTool<ToolKind, Schema | undefined, infer O>
    ? O extends Schema
      ? StandardSchemaV1.InferOutput<O>
      : void
    : never;
export interface ToolIdentity {
  readonly subjectId?: string;
  readonly installationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly deploymentId: string;
  readonly scope: { name: string; value: Record<string, unknown> };
  readonly expiresAt: number;
}
export interface ToolContext {
  readonly identity: ToolIdentity;
  readonly scope: ToolIdentity["scope"];
  readonly requestId: string;
}
export interface ToolImplementationTree {
  [name: string]:
    | { bivarianceHack(options: { input: never; context: ToolContext }): unknown }["bivarianceHack"]
    | ToolImplementationTree;
}
export type ToolImplementations<
  T extends ContractTools,
  K extends ToolKind,
> = string extends keyof T
  ? ToolImplementationTree
  : {
      [
        N in keyof T as T[N] extends ContractTool
          ? T[N]["kind"] extends K
            ? N
            : never
          : keyof ToolImplementations<Extract<T[N], ContractTools>, K> extends never
            ? never
            : N
      ]: T[N] extends ContractTool<K, infer I, infer O>
        ? (options: {
            input: I extends Schema ? StandardSchemaV1.InferOutput<I> : undefined;
            context: ToolContext;
          }) =>
            | (O extends Schema ? StandardSchemaV1.InferInput<O> : void)
            | Promise<O extends Schema ? StandardSchemaV1.InferInput<O> : void>
        : ToolImplementations<Extract<T[N], ContractTools>, K>;
    };
export interface ToolCallerTree {
  [name: string]: ((input?: unknown) => Promise<unknown>) | ToolCallerTree;
}
export type ToolCallers<
  T extends ContractTools,
  K extends ToolKind = ToolKind,
> = string extends keyof T
  ? ToolCallerTree
  : {
      [
        N in keyof T as T[N] extends ContractTool
          ? T[N]["kind"] extends K
            ? N
            : never
          : keyof ToolCallers<Extract<T[N], ContractTools>, K> extends never
            ? never
            : N
      ]: T[N] extends ContractTool
        ? (
            ...args: undefined extends InferToolInput<T[N]>
              ? [input?: InferToolInput<T[N]>]
              : [input: InferToolInput<T[N]>]
          ) => Promise<InferToolOutput<T[N]>>
        : ToolCallers<Extract<T[N], ContractTools>, K>;
    };
export function flattenTools(tools: ContractTools, prefix = ""): Map<string, ContractTool> {
  const result = new Map<string, ContractTool>();
  for (const [name, value] of Object.entries(tools)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(name) ||
      ["constructor", "prototype", "__proto__"].includes(name)
    )
      throw new Error(`Invalid tool name "${name}"`);
    const path = prefix + name;
    if (value.$tailorkitToolDefinition === true) {
      const leaf = value as ContractTool;
      if (!["client", "server"].includes(leaf.kind) || !leaf.definition)
        throw new Error(`Invalid tool declaration "${path}"`);
      result.set(path, leaf);
    } else
      for (const [key, leaf] of flattenTools(value as ContractTools, path + "."))
        result.set(key, leaf);
  }
  return result;
}
export function serializeTools(
  tools: ContractTools,
  serializer?: SchemaSerializer,
): TailorKitSchemaSpec["tools"] {
  const result: TailorKitSchemaSpec["tools"] = {};
  for (const [name, value] of Object.entries(tools)) {
    if (!value) continue;
    if (value.$tailorkitToolDefinition === true) {
      const leaf = value as ContractTool;
      result[name] = {
        kind: leaf.kind,
        input: serializeSchema(leaf.definition.input, serializer, "input"),
        output: serializeSchema(leaf.definition.output, serializer),
      };
    } else result[name] = serializeTools(value as ContractTools, serializer);
  }
  return result;
}
export async function validateToolValue(
  schema: Schema | undefined,
  value: unknown,
): Promise<unknown> {
  if (!schema) {
    if (value !== undefined) throw new Error("Tool expects no value");
    return undefined;
  }
  const result = await schema["~standard"].validate(value);
  if (result.issues) throw new Error("Invalid tool payload");
  return result.value;
}
