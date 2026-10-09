import { z } from "zod";

/** Parse view context, stripping undeclared fields from closed objects. */
export function createViewContextParser(schema: Record<string, unknown>) {
  const validator = stripUnknownKeys(z.fromJSONSchema(schema));
  return (context: unknown) => validator.safeParse(context);
}

/** Validate supplied context without mutating the value registered by the host. */
export function createViewContextValidator(schema: Record<string, unknown>) {
  const parse = createViewContextParser(schema);
  return (context: unknown) => {
    const result = parse(context);
    return result.success ? null : result.error.issues;
  };
}

// JSON Schema describes the output shape, so a stripping object is serialized
// with additionalProperties: false and reconstructed as a strict Zod object.
// Restore stripping throughout the generated schema, preserving its other checks.
function stripUnknownKeys(root: z.ZodType): z.ZodType {
  const schemas = new WeakMap<z.ZodType, z.ZodType>();
  const visitValue = (value: unknown): unknown => {
    if (value instanceof z.ZodType) return visit(value);
    if (Array.isArray(value)) return value.map(visitValue);
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, visitValue(item)]),
      );
    }
    return value;
  };
  const visit = (schema: z.ZodType): z.ZodType => {
    const cached = schemas.get(schema);
    if (cached) return cached;
    // References can be recursive. The lazy placeholder resolves to the clone
    // after its definition has been traversed.
    const reference = z.lazy(() => schemas.get(schema)!);
    schemas.set(schema, reference);
    const definition = Object.fromEntries(
      Object.entries(schema.def).map(([key, value]) => [key, visitValue(value)]),
    );
    if (schema instanceof z.ZodObject && schema.def.catchall instanceof z.ZodNever) {
      definition.catchall = undefined;
    }
    if (schema instanceof z.ZodLazy) {
      definition.getter = () => visitValue(schema.def.getter());
    }
    const clone = schema.clone({ ...schema.def, ...definition });
    schemas.set(schema, clone);
    return clone;
  };
  return visit(root);
}
