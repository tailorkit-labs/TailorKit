import { z } from "zod";

const JSONType = z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]);

/**
 * Models the exact JSON Schema 2020-12 subset emitted by `z.toJSONSchema()`.
 * Strict — unknown keys (including `x-` extensions) are rejected.
 * We're being strict just so we know exactly what we're dealing with. If we need
 * to support additional schema features, we can add them incrementally.
 */
export const JsonSchema: z.ZodType<Record<string, unknown>> = z
  .object({
    $schema: z.enum(["https://json-schema.org/draft/2020-12/schema"]).optional(),
    type: z.union([JSONType, z.array(z.string())]).optional(),
    properties: z.lazy(() => z.record(z.string(), JsonSchema)).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.union([z.boolean(), z.lazy(() => JsonSchema)]).optional(),
    enum: z.array(z.unknown()).optional(),
    const: z.unknown().optional(),
    items: z.union([z.boolean(), z.lazy(() => JsonSchema)]).optional(),
    prefixItems: z.lazy(() => z.array(JsonSchema)).optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    propertyNames: z.lazy(() => JsonSchema).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    anyOf: z.lazy(() => z.array(JsonSchema)).optional(),
    oneOf: z.lazy(() => z.array(JsonSchema)).optional(),
    allOf: z.lazy(() => z.array(JsonSchema)).optional(),
    not: z.lazy(() => JsonSchema).optional(),
  })
  .strict();

export type JsonSchema = z.infer<typeof JsonSchema>;
