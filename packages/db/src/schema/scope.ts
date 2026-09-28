import z from "zod";

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type ScopeValue = JsonObject;
export type Scope = {
  name: string;
  value: ScopeValue;
};

const maxObjectEntries = 32;
const maxArrayEntries = 100;
const maxStringLength = 255;
const maxKeyLength = 64;
const maxDepth = 16;
const maxNodes = 512;
const maxSerializedBytes = 16 * 1024;

export const scopeNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u);
export const scopeKeySchema = z.string().regex(/^[a-f0-9]{32}$/u);

function quotedByteLength(value: string) {
  const json = JSON.stringify(value);
  return json ? new TextEncoder().encode(json).byteLength : 0;
}

function preflightScopeValue(value: unknown): string | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return "Scope value must be a nonempty plain object.";
  }

  let nodes = 1; // Include the root object, as the platform canonicalizer does.
  let bytes = 2; // root object braces
  let valid = true;
  let issue: string | null = null;
  const fail = (message: string) => {
    valid = false;
    issue ??= message;
  };
  const active = new WeakSet<object>();
  const addBytes = (amount: number) => {
    bytes += amount;
    if (bytes > maxSerializedBytes) fail("Scope value exceeds 16 KiB of JSON.");
  };
  const visit = (current: unknown, depth: number): number => {
    nodes += 1;
    if (nodes > maxNodes) {
      fail("Scope value exceeds 512 JSON values.");
      return 0;
    }
    if (current === null) return 4;
    if (typeof current === "boolean") return current ? 4 : 5;
    if (typeof current === "string") {
      if (current.length > maxStringLength) {
        fail("Scope strings cannot exceed 255 characters.");
        return 0;
      }
      return quotedByteLength(current);
    }
    if (typeof current === "number") {
      if (
        !Number.isFinite(current) ||
        Object.is(current, -0) ||
        (Number.isInteger(current) && !Number.isSafeInteger(current))
      ) {
        fail("Scope numbers must be finite, safe integers, and cannot be -0.");
      }
      return String(JSON.stringify(current)).length;
    }
    if (typeof current !== "object" || depth > maxDepth || active.has(current)) {
      fail("Scope value exceeds the allowed depth, contains a cycle, or is not JSON.");
      return 0;
    }

    active.add(current);
    let currentBytes = 2;
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype || current.length > maxArrayEntries) {
        fail("Scope arrays must be standard arrays with at most 100 entries.");
      }
      const keys = Reflect.ownKeys(current);
      if (keys.length !== current.length + 1 || !keys.includes("length")) {
        fail("Scope arrays must be dense and contain no extra properties.");
      }
      for (let index = 0; index < current.length && valid; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          fail("Scope arrays must contain enumerable data properties.");
          break;
        }
        if (index > 0) currentBytes += 1;
        currentBytes += visit(descriptor.value, depth + 1);
      }
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        fail("Scope values must contain only plain objects.");
      }
      const keys = Reflect.ownKeys(current);
      if (keys.length > maxObjectEntries) fail("Scope objects cannot exceed 32 entries.");
      for (let index = 0; index < keys.length && valid; index += 1) {
        const key = keys[index];
        if (
          typeof key !== "string" ||
          key === "__proto__" ||
          key.length === 0 ||
          key.length > maxKeyLength
        ) {
          fail("Scope keys must contain 1–64 characters and cannot be __proto__.");
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          fail("Scope objects must contain enumerable data properties.");
          break;
        }
        if (index > 0) currentBytes += 1;
        currentBytes += quotedByteLength(key) + 1 + visit(descriptor.value, depth + 1);
      }
    }
    active.delete(current);
    return currentBytes;
  };

  const rootKeys = Reflect.ownKeys(value);
  if (rootKeys.length === 0 || rootKeys.length > maxObjectEntries) {
    return "Scope value must contain 1–32 entries.";
  }
  for (let index = 0; index < rootKeys.length && valid; index += 1) {
    const key = rootKeys[index];
    if (
      typeof key !== "string" ||
      key === "__proto__" ||
      key.length === 0 ||
      key.length > maxKeyLength
    ) {
      return "Scope keys must contain 1–64 characters and cannot be __proto__.";
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return "Scope objects must contain enumerable data properties.";
    }
    if (index > 0) addBytes(1);
    addBytes(quotedByteLength(key) + 1 + visit(descriptor.value, 1));
  }
  return valid ? null : (issue ?? "Invalid scope value.");
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string().max(maxStringLength),
    z
      .number()
      .finite()
      .refine((value) => !Object.is(value, -0), "-0 is not a supported scope number.")
      .refine(
        (value) => !Number.isInteger(value) || Number.isSafeInteger(value),
        "Integer scope values must be safe integers.",
      ),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema).max(maxArrayEntries),
    z.record(z.string().min(1).max(maxKeyLength), jsonValueSchema),
  ]),
);

const scopeObjectSchema = z.record(z.string().min(1).max(maxKeyLength), jsonValueSchema);

export const scopeValueSchema = z.preprocess((value, context) => {
  const issue = preflightScopeValue(value);
  if (issue) context.addIssue({ code: "custom", message: issue });
  return value;
}, scopeObjectSchema);

export const scopeSchema = z
  .object({
    name: scopeNameSchema,
    value: scopeValueSchema,
  })
  .strict();

export const scopesSchema = z.preprocess((value, context) => {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length === 0 ||
    value.length > maxObjectEntries
  ) {
    context.addIssue({ code: "custom", message: "Select 1–32 named scopes." });
  }
  return value;
}, z.array(scopeSchema).min(1).max(maxObjectEntries));
