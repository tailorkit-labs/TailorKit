import { expect, it, vi } from "vite-plus/test";
import * as v from "valibot";
import { serializeSchema } from "./shared";

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
