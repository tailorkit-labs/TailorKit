import { createHash } from "node:crypto";
import { scopeValueSchema, type Scope } from "@tailorkit/db/schema/scope";

export const scopeSchema = scopeValueSchema;

/** Validates and canonicalizes a host-provided scope before deriving its versioned key. */
export function canonicalizeScope(value: unknown): { scope: Scope; scopeKey: string } {
  const parsedScope = scopeSchema.parse(value);
  const scope = Object.fromEntries(
    Object.keys(parsedScope)
      .sort()
      .map((key) => [key, parsedScope[key] as string]),
  );
  Object.freeze(scope);
  const scopeKey = createHash("sha256")
    .update(`scope:v1:${JSON.stringify(scope)}`)
    .digest("hex");

  return { scope, scopeKey };
}

export function scopeMatches(left: unknown, right: unknown): boolean {
  const canonicalLeft = canonicalizeScope(left);
  const canonicalRight = canonicalizeScope(right);
  return (
    canonicalLeft.scopeKey === canonicalRight.scopeKey &&
    JSON.stringify(canonicalLeft.scope) === JSON.stringify(canonicalRight.scope)
  );
}
