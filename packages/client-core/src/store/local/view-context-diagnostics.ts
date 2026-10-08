import { createViewContextValidator } from "@tailorkit/core/spec";
import type { TailorKitSchemaSpecType } from "@tailorkit/core/spec";
import type { ViewEntry } from "./view-context";

type Definition = TailorKitSchemaSpecType["views"][string];
interface Diagnostic {
  message: string;
  details?: unknown;
}
type Validation = { validate: ReturnType<typeof createViewContextValidator> } | { error: unknown };

/** Cache validators by schema identity; metadata refreshes can replace schemas. */
export function createViewContextDiagnostics() {
  const validators = new WeakMap<Record<string, unknown>, Validation>();
  return (entry: ViewEntry, definition: Definition | undefined): Diagnostic | null => {
    if (entry.status !== "ready" || !definition) return null;
    const { context, view } = entry;
    if (context === undefined) {
      return definition.context && !definition.contextOptional
        ? {
            message: `TailorKit view "${view}" is ready without its required context. Supply context or set loading: true while it is unavailable.`,
          }
        : null;
    }
    if (context === null || typeof context !== "object" || Array.isArray(context)) {
      return {
        message: `TailorKit view "${view}" requires an object context that matches the view's schema.`,
      };
    }
    if (!definition.context) return null;
    let validation = validators.get(definition.context);
    if (!validation) {
      try {
        validation = { validate: createViewContextValidator(definition.context) };
      } catch (error) {
        validation = { error };
      }
      validators.set(definition.context, validation);
    }
    if ("error" in validation) {
      return {
        message: `TailorKit could not validate context for view "${view}" against its JSON Schema.`,
        details: validation.error,
      };
    }
    const issues = validation.validate(context);
    return issues
      ? {
          message: `TailorKit view "${view}" received context that does not match the view's schema.`,
          details: issues,
        }
      : null;
  };
}
