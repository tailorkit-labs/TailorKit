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

function quotedByteLength(value: string) {
  const json = JSON.stringify(value);
  return json ? new TextEncoder().encode(json).byteLength : 0;
}

function preflightScopeValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }

  let nodes = 0;
  let bytes = 2; // root object braces
  let valid = true;
  const active = new WeakSet<object>();
  const addBytes = (amount: number) => {
    bytes += amount;
    if (bytes > maxSerializedBytes) valid = false;
  };
  const visit = (current: unknown, depth: number): number => {
    nodes += 1;
    if (nodes > maxNodes) {
      valid = false;
      return 0;
    }
    if (current === null) return 4;
    if (typeof current === "boolean") return current ? 4 : 5;
    if (typeof current === "string") {
      if (current.length > maxStringLength) valid = false;
      return quotedByteLength(current);
    }
    if (typeof current === "number") {
      if (
        !Number.isFinite(current) ||
        Object.is(current, -0) ||
        (Number.isInteger(current) && !Number.isSafeInteger(current))
      ) {
        valid = false;
      }
      return String(JSON.stringify(current)).length;
    }
    if (typeof current !== "object" || depth > maxDepth || active.has(current)) {
      valid = false;
      return 0;
    }

    active.add(current);
    let currentBytes = 2;
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype || current.length > maxArrayEntries) {
        valid = false;
      }
      const keys = Reflect.ownKeys(current);
      if (keys.length !== current.length + 1 || !keys.includes("length")) valid = false;
      for (let index = 0; index < current.length && valid; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          valid = false;
          break;
        }
        if (index > 0) currentBytes += 1;
        currentBytes += visit(descriptor.value, depth + 1);
      }
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) valid = false;
      const keys = Reflect.ownKeys(current);
      if (keys.length > maxObjectEntries) valid = false;
      for (let index = 0; index < keys.length && valid; index += 1) {
        const key = keys[index];
        if (
          typeof key !== "string" ||
          key === "__proto__" ||
          key.length === 0 ||
          key.length > maxKeyLength
        ) {
          valid = false;
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          valid = false;
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
  if (rootKeys.length === 0 || rootKeys.length > maxObjectEntries) return false;
  for (let index = 0; index < rootKeys.length && valid; index += 1) {
    const key = rootKeys[index];
    if (
      typeof key !== "string" ||
      key === "__proto__" ||
      key.length === 0 ||
      key.length > maxKeyLength
    ) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return false;
    if (index > 0) addBytes(1);
    addBytes(quotedByteLength(key) + 1 + visit(descriptor.value, 1));
  }
  return valid;
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

export const scopeValueSchema = z.preprocess(
  (value) => (preflightScopeValue(value) ? value : undefined),
  scopeObjectSchema,
);

export const scopeSchema = z
  .object({
    name: scopeNameSchema,
    value: scopeValueSchema,
  })
  .strict();

export const scopesSchema = z.preprocess(
  (value) =>
    Array.isArray(value) &&
    Object.getPrototypeOf(value) === Array.prototype &&
    value.length > 0 &&
    value.length <= maxObjectEntries
      ? value
      : undefined,
  z.array(scopeSchema).min(1).max(maxObjectEntries),
);
