import { expect, it, vi } from "vite-plus/test";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import * as v from "valibot";
import { type } from "arktype";
import { jsonSchemaSerializer, serializeSchema } from "./shared";

it("passes the output mode and current target to a JSON Schema converter", () => {
  const jsonSchema = { type: "number" };
  const converter = vi.fn(() => jsonSchema);
  const schema = v.string();
  expect(serializeSchema(schema, converter)).toBe(jsonSchema);
  expect(converter).toHaveBeenCalledExactlyOnceWith(schema, {
    target: "draft-2020-12",
    typeMode: "output",
  });
});

it("passes input mode to a custom JSON Schema converter when requested", () => {
  const jsonSchema = { type: "string" };
  const converter = vi.fn(() => jsonSchema);
  const schema = v.string();
  expect(serializeSchema(schema, converter, "input")).toBe(jsonSchema);
  expect(converter).toHaveBeenCalledExactlyOnceWith(schema, {
    target: "draft-2020-12",
    typeMode: "input",
  });
});

it("selects the matching Standard JSON Schema method and defaults to output", () => {
  const inputSchema = { type: "string" };
  const outputSchema = { type: "number" };
  const input = vi.fn(() => inputSchema);
  const output = vi.fn(() => outputSchema);
  const schema: StandardSchemaV1 & StandardJSONSchemaV1 = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => ({ value }),
      jsonSchema: { input, output },
    },
  };
  expect(serializeSchema(schema, jsonSchemaSerializer, "input")).toBe(inputSchema);
  expect(input).toHaveBeenCalledExactlyOnceWith({ target: "draft-2020-12" });
  expect(output).not.toHaveBeenCalled();
  expect(serializeSchema(schema, jsonSchemaSerializer)).toBe(outputSchema);
  expect(jsonSchemaSerializer(schema)).toBe(outputSchema);
  expect(output).toHaveBeenCalledTimes(2);
  expect(output).toHaveBeenCalledWith({ target: "draft-2020-12" });
});

it("serializes ArkType morph inputs before parsing and outputs after parsing", () => {
  const schema = type("string").pipe(Number, type("number"));
  expect(serializeSchema(schema, jsonSchemaSerializer, "input")).toMatchObject({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "string",
  });
  expect(serializeSchema(schema, jsonSchemaSerializer)).toMatchObject({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "number",
  });
});

it("preserves plain JSON Schema serializers, including extension properties", () => {
  const jsonSchema = { type: "string", "~standard": { description: "Extension" } };
  expect(serializeSchema(v.string(), () => jsonSchema)).toBe(jsonSchema);
  expect(serializeSchema(v.string(), () => undefined)).toBeUndefined();
});

it("does not invoke serialization for absent schemas or serializers", () => {
  const serializer = vi.fn(() => ({ type: "string" }));
  expect(serializeSchema(undefined, serializer)).toBeUndefined();
  expect(serializer).not.toHaveBeenCalled();
  expect(serializeSchema(v.string(), undefined)).toBeUndefined();
});
