import type { Schema } from "@tailorkit/core/schema";
import type { ViewEntry } from "./view-context";

export interface ViewContextDiagnostic {
  message: string;
  details?: unknown;
}
export type ViewContextResult = { value: unknown } | ViewContextDiagnostic;

/** Validate through the original schema and preserve its parsed output. */
export function validateViewContext(
  entry: ViewEntry,
  schema: Schema | undefined,
): ViewContextResult | Promise<ViewContextResult> {
  if (entry.status !== "ready") return { value: undefined };
  const { context, view } = entry;
  if (!schema) {
    return { message: `TailorKit view "${view}" is not declared in the contract.` };
  }
  if (
    context !== undefined &&
    (context === null || typeof context !== "object" || Array.isArray(context))
  ) {
    return {
      message: `TailorKit view "${view}" requires an object context that matches the view's schema.`,
    };
  }
  const classify = (
    result: Awaited<ReturnType<Schema["~standard"]["validate"]>>,
  ): ViewContextResult => {
    if (!result.issues) return { value: result.value };
    return context === undefined
      ? {
          message: `TailorKit view "${view}" is ready without its required context. Supply context or set loading: true while it is unavailable.`,
        }
      : {
          message: `TailorKit view "${view}" received context that does not match the view's schema.`,
          details: result.issues,
        };
  };
  const result = schema["~standard"].validate(context);
  return "then" in result ? result.then(classify) : classify(result);
}
