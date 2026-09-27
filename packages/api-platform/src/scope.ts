import { createHash } from "node:crypto";
import { scopeValueSchema, type Scope } from "@tailorkit/db/schema/scope";

export const scopeSchema = scopeValueSchema;

function assertPlainScopeRecord(value: unknown): asserts value is Scope {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError("Scope must be a plain object or null-prototype record.");
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Scope entries must use string keys.");
  }
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Scope entries must be own data properties.");
    }
  }
}

/** Validates and canonicalizes a host-provided scope before deriving its versioned key. */
export function canonicalizeScope(value: unknown): { scope: Scope; scopeKey: string } {
  assertPlainScopeRecord(value);
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
