import { z } from "zod";

/** Validate supplied context without transforming the value registered by the host. */
export function createViewContextValidator(schema: Record<string, unknown>) {
  const validator = z.fromJSONSchema(schema);
  return (context: unknown) => {
    const result = validator.safeParse(context);
    return result.success ? null : result.error.issues;
  };
}
