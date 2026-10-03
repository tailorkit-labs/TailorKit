import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { JsonSchema } from "./json-schema";

describe("JSON Schema spec", () => {
  it.each([
    { name: "integer", schema: z.int() },
    { name: "record", schema: z.record(z.string(), z.number().nullable()) },
    { name: "fixed tuple", schema: z.tuple([z.string(), z.number()]) },
    { name: "optional tuple", schema: z.tuple([z.string(), z.number().optional()]) },
    { name: "rest tuple", schema: z.tuple([z.string()], z.number().nullable()) },
    { name: "nullable tuple", schema: z.tuple([z.string(), z.boolean()]).nullable() },
  ])("preserves serialized $name schemas", ({ schema }) => {
    const serialized = schema["~standard"].jsonSchema.output({ target: "draft-2020-12" });
    expect(JsonSchema.parse(serialized)).toEqual(serialized);
  });

  it("continues to reject unsupported keywords", () => {
    expect(JsonSchema.safeParse({ type: "string", "x-custom": true }).success).toBe(false);
  });

  it.each([-1, 1.5])("rejects invalid tuple lengths: %s", (length) => {
    expect(JsonSchema.safeParse({ type: "array", minItems: length }).success).toBe(false);
    expect(JsonSchema.safeParse({ type: "array", maxItems: length }).success).toBe(false);
  });
});
