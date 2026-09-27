import z from "zod";

export type Scope = Record<string, string>;

export const scopeValueSchema = z
  .record(z.string().min(1).max(64), z.string().min(1).max(255))
  .superRefine((scope, context) => {
    const keys = Object.keys(scope);
    if (keys.length === 0 || keys.length > 32) {
      context.addIssue({ code: "custom", message: "Scope must contain 1–32 entries." });
    }
    if (Object.getOwnPropertySymbols(scope).length > 0) {
      context.addIssue({ code: "custom", message: "Scope entries must use string keys." });
    }
  });
