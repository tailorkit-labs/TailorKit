import { createHash } from "node:crypto";
import {
  scopeSchema as namedScopeSchema,
  scopeValueSchema,
  scopesSchema,
  type JsonObject,
  type JsonValue,
  type Scope,
} from "@tailorkit/db/schema/scope";

export const scopeSchema = namedScopeSchema;
export { scopeValueSchema, scopesSchema };
export type { JsonObject, JsonValue, Scope };

const maxObjectEntries = 32;
const maxArrayEntries = 100;
const maxStringLength = 255;
const maxKeyLength = 64;
const maxDepth = 16;
const maxNodes = 512;
const maxSerializedBytes = 16 * 1024;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }
  return true;
}

function validateOwnDataProperties(value: object, keys: readonly PropertyKey[]) {
  for (const key of keys) {
    if (typeof key !== "string") {
      throw new TypeError("Scope values cannot contain symbol keys.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Scope values must use enumerable own data properties.");
    }
  }
}

function canonicalizeJsonValue(
  value: unknown,
  state: { active: WeakSet<object>; nodes: number },
  depth: number,
): JsonValue {
  state.nodes += 1;
  if (state.nodes > maxNodes) {
    throw new TypeError("Scope value cannot contain more than 512 values.");
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > maxStringLength) {
      throw new TypeError("Scope strings cannot exceed 255 characters.");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("Scope numbers must be finite and cannot be -0.");
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError("Integer scope values must be safe integers.");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Scope values must contain only JSON values.");
  }
  if (depth > maxDepth) {
    throw new TypeError("Scope values cannot exceed a depth of 16.");
  }
  if (state.active.has(value)) {
    throw new TypeError("Scope values cannot contain cycles.");
  }

  state.active.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError("Scope arrays must use the standard array prototype.");
    }
    if (value.length > maxArrayEntries) {
      throw new TypeError("Scope arrays cannot contain more than 100 entries.");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) {
      throw new TypeError("Scope arrays must be dense and cannot have extra properties.");
    }
    validateOwnDataProperties(
      value,
      ownKeys.filter((key): key is string => key !== "length"),
    );
    const canonical: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Scope arrays must be dense and cannot contain accessors.");
      }
      canonical[index] = canonicalizeJsonValue(descriptor.value, state, depth + 1);
    }
    state.active.delete(value);
    return canonical;
  }

  if (!isPlainRecord(value)) {
    throw new TypeError("Scope values must contain only plain objects.");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > maxObjectEntries) {
    throw new TypeError("Scope objects cannot contain more than 32 entries.");
  }
  validateOwnDataProperties(value, ownKeys);
  const keys = ownKeys as string[];
  for (const key of keys) {
    if (key === "__proto__" || key.length === 0 || key.length > maxKeyLength) {
      throw new TypeError("Scope object keys must contain 1–64 characters.");
    }
  }
  const canonical: Record<string, JsonValue> = Object.create(null);
  for (const key of keys.sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Scope values cannot contain accessors.");
    }
    canonical[key] = canonicalizeJsonValue(descriptor.value, state, depth + 1);
  }
  state.active.delete(value);
  return canonical;
}

function canonicalizeScopeValue(value: unknown): JsonObject {
  if (!isPlainRecord(value)) {
    throw new TypeError("Named scope value must be a plain object.");
  }
  const state = { active: new WeakSet<object>(), nodes: 0 };
  const canonicalValue = canonicalizeJsonValue(value, state, 0);
  if (
    Array.isArray(canonicalValue) ||
    canonicalValue === null ||
    typeof canonicalValue !== "object"
  ) {
    throw new TypeError("Named scope value must be a plain object.");
  }
  if (Object.keys(canonicalValue).length === 0) {
    throw new TypeError("Named scope value must contain at least one entry.");
  }
  if (Buffer.byteLength(serializeJsonValue(canonicalValue), "utf8") > maxSerializedBytes) {
    throw new TypeError("Named scope value cannot exceed 16 KiB when serialized.");
  }
  return canonicalValue;
}

function serializeJsonValue(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("Scope value is not valid JSON.");
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeJsonValue(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeJsonValue(value[key] as JsonValue)}`)
    .join(",")}}`;
}

function serializeScope(scope: Scope): string {
  return `{"name":${JSON.stringify(scope.name)},"value":${serializeJsonValue(scope.value)}}`;
}

/** Validates and recursively canonicalizes a named scope before deriving its stable key. */
export function canonicalizeScope(value: unknown): { scope: Scope; scopeKey: string } {
  if (!isPlainRecord(value)) {
    throw new TypeError("Scope must be a plain object.");
  }
  const keys = Reflect.ownKeys(value);
  validateOwnDataProperties(value, keys);
  if (keys.length !== 2 || !keys.includes("name") || !keys.includes("value")) {
    throw new TypeError("Named scope must contain only name and value properties.");
  }
  const name = (value as Record<string, unknown>).name;
  if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(name)) {
    throw new TypeError(
      "Scope name must be 1–64 letters, digits, underscores, or hyphens and start with a letter.",
    );
  }
  const valueScope = canonicalizeScopeValue((value as Record<string, unknown>).value);
  const scope = Object.create(null) as Scope;
  scope.name = name;
  scope.value = valueScope;
  const serialized = serializeScope(scope);
  const scopeKey = createHash("sha512").update(`scope:v2:${serialized}`).digest("hex").slice(0, 32);
  return { scope, scopeKey };
}

/** Canonicalizes an exact set of named identities for one multi-scope read. */
export function canonicalizeScopes(value: unknown) {
  const parsed = scopesSchema.parse(value);
  const scopes = parsed.map((scope) => canonicalizeScope(scope));
  const seen = new Set<string>();
  for (const entry of scopes) {
    const serialized = serializeScope(entry.scope);
    if (seen.has(serialized)) {
      throw new TypeError("Multi-scope reads cannot contain duplicate identities.");
    }
    seen.add(serialized);
  }
  return scopes;
}

export function scopeMatches(left: unknown, right: unknown): boolean {
  const canonicalLeft = canonicalizeScope(left);
  const canonicalRight = canonicalizeScope(right);
  return (
    canonicalLeft.scopeKey === canonicalRight.scopeKey &&
    serializeScope(canonicalLeft.scope) === serializeScope(canonicalRight.scope)
  );
}
