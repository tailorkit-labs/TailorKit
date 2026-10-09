import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";

export type Schema = StandardSchemaV1;
export type EmptyObject = unknown;
export type MaybePromise<T> = T | Promise<T>;

export type InferSchema<TSchema> = TSchema extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TSchema>
  : EmptyObject;

export type MergeProps<TBase, TOverride> = Omit<TBase, keyof TOverride> & TOverride;

export type SchemaSerializer = (schema: Schema) => Record<string, unknown> | undefined;

export const jsonSchemaSerializer: SchemaSerializer = (schema) => {
  const properties = schema["~standard"] as StandardSchemaV1.Props &
    Partial<StandardJSONSchemaV1.Props>;
  if (!properties.jsonSchema) {
    throw new Error(
      "This schema does not implement Standard JSON Schema. Supply a schemaSerializer when creating the server.",
    );
  }
  return properties.jsonSchema.output({ target: "draft-2020-12" });
};

export const serializeSchema = (
  schema: Schema | undefined,
  schemaSerializer: SchemaSerializer | undefined,
): Record<string, unknown> | undefined =>
  schema === undefined || schemaSerializer === undefined ? undefined : schemaSerializer(schema);
