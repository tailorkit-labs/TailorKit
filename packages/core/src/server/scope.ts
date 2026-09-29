import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { TailorKitNamedScope, TailorKitScope, TailorKitScopes } from "./types";

const maximumObjectKeys = 32;
const maximumKeyLength = 64;
const maximumStringLength = 255;
const maximumDepth = 16;
const maximumArrayLength = 100;
const maximumJsonBytes = 16 * 1024;
const maximumNodes = 512;
const scopeNamePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

export type TailorKitScopeSchemas = Record<string, StandardSchemaV1>;

export function validateTailorKitScopeSchemas(value: unknown): TailorKitScopeSchemas {
  assertPlainRecord(value, "TailorKit scopes must be an object of Standard Schema validators.");
  const entries = getRecordEntries(
    value,
    "TailorKit scopes must contain enumerable validator data properties.",
  );
  if (entries.length === 0) {
    throw new TypeError("TailorKit must declare at least one named scope.");
  }
  if (entries.length > maximumObjectKeys) {
    throw new TypeError(`TailorKit may declare at most ${maximumObjectKeys} named scopes.`);
  }
  const schemas: [string, StandardSchemaV1][] = [];
  for (const [name, schema] of entries) {
    validateTailorKitScopeName(name);
    const standard =
      typeof schema === "object" && schema !== null ? Reflect.get(schema, "~standard") : undefined;
    if (
      typeof standard !== "object" ||
      standard === null ||
      typeof Reflect.get(standard, "validate") !== "function"
    ) {
      throw new TypeError(`TailorKit scope "${name}" must be a Standard Schema validator.`);
    }
    schemas.push([name, schema as StandardSchemaV1]);
  }
  return Object.fromEntries(schemas);
}

export async function validateTailorKitScopes(
  scopeSchemas: TailorKitScopeSchemas,
  value: unknown,
): Promise<TailorKitScopes> {
  assertPlainRecord(value, "TailorKit authenticate() must return a scopes object.");
  const inputEntries = getRecordEntries(
    value,
    "TailorKit authenticate() scopes must be data properties.",
  );
  if (inputEntries.length === 0) {
    throw new TypeError("TailorKit authenticate() must return at least one scope.");
  }

  const validatedEntries: [string, TailorKitScope][] = [];
  for (const [name, scopeValue] of inputEntries) {
    if (!Object.hasOwn(scopeSchemas, name)) {
      throw new TypeError(`TailorKit authenticate() returned undeclared scope "${name}".`);
    }

    const scopeSchema = scopeSchemas[name];
    if (!scopeSchema) {
      throw new TypeError(`TailorKit authenticate() returned undeclared scope "${name}".`);
    }
    const result = await scopeSchema["~standard"].validate(scopeValue);
    if (result.issues) {
      throw new TypeError(
        `TailorKit authenticate() returned scope "${name}" that failed its Standard Schema validation.`,
      );
    }

    if (result.value !== undefined) {
      validatedEntries.push([name, normalizeTailorKitScope(result.value)]);
    }
  }

  if (validatedEntries.length === 0) {
    throw new TypeError("TailorKit authenticate() must return at least one available scope.");
  }

  validatedEntries.sort(([left], [right]) => compareStrings(left, right));
  return Object.freeze(Object.fromEntries(validatedEntries));
}

export function validateTailorKitScopeName(name: string): string {
  if (!scopeNamePattern.test(name)) {
    throw new TypeError(
      'TailorKit scope names must start with a letter and contain only letters, numbers, "_", or "-".',
    );
  }
  return name;
}

export function normalizeTailorKitScope(value: unknown): TailorKitScope {
  if (!isPlainRecord(value)) {
    throw new TypeError("TailorKit scope values must be nonempty plain JSON objects.");
  }

  let nodes = 0;
  const ancestors = new Set<object>();
  const normalized = normalizeJsonValue(value, 0, true, ancestors, () => {
    nodes += 1;
    if (nodes > maximumNodes) {
      throw new TypeError(
        `TailorKit scope values may contain at most ${maximumNodes} JSON values.`,
      );
    }
  });
  const json = JSON.stringify(normalized);
  if (json === undefined || new TextEncoder().encode(json).byteLength > maximumJsonBytes) {
    throw new TypeError(`TailorKit scope values may not exceed ${maximumJsonBytes} bytes of JSON.`);
  }
  return normalized as TailorKitScope;
}

export function normalizeTailorKitNamedScope(value: unknown): TailorKitNamedScope {
  if (!isPlainRecord(value)) {
    throw new TypeError("TailorKit scope identity must contain a name and value.");
  }
  const entries = getRecordEntries(value, "TailorKit scope identity must contain data properties.");
  if (entries.length !== 2 || !Object.hasOwn(value, "name") || !Object.hasOwn(value, "value")) {
    throw new TypeError("TailorKit scope identity must contain only a name and value.");
  }
  const name = Object.getOwnPropertyDescriptor(value, "name")?.value;
  const scopeValue = Object.getOwnPropertyDescriptor(value, "value")?.value;
  if (typeof name !== "string") {
    throw new TypeError("TailorKit scope identity must contain a name and value.");
  }
  validateTailorKitScopeName(name);
  return { name, value: normalizeTailorKitScope(scopeValue) };
}

export function selectTailorKitScopes(
  availableScopes: TailorKitScopes,
  selectedNames?: readonly string[],
): TailorKitNamedScope[] {
  const names = selectedNames ?? Object.keys(availableScopes);
  if (names.length === 0) {
    throw new TypeError("At least one TailorKit scope must be selected.");
  }

  const selected: TailorKitNamedScope[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    validateTailorKitScopeName(name);
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    if (!Object.hasOwn(availableScopes, name)) {
      throw new TypeError(`TailorKit scope "${name}" is not available for this request.`);
    }
    const value = availableScopes[name];
    if (!value) {
      throw new TypeError(`TailorKit scope "${name}" is not available for this request.`);
    }
    selected.push({ name, value });
  }

  if (selected.length === 0) {
    throw new TypeError("At least one TailorKit scope must be selected.");
  }
  return selected;
}

function normalizeJsonValue(
  value: unknown,
  depth: number,
  isRoot: boolean,
  ancestors: Set<object>,
  countNode: () => void,
): unknown {
  countNode();
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && value.length > maximumStringLength) {
      throw new TypeError(
        `TailorKit scope strings may not exceed ${maximumStringLength} characters.`,
      );
    }
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("TailorKit scope numbers must be finite and safe when integral.");
    }
    if (Object.is(value, -0)) {
      throw new TypeError("TailorKit scope numbers may not be negative zero.");
    }
    return value;
  }

  if (typeof value !== "object") {
    throw new TypeError("TailorKit scope values must contain only JSON values.");
  }
  if (depth > maximumDepth) {
    throw new TypeError(
      `TailorKit scope values may be nested at most ${maximumDepth} levels deep.`,
    );
  }
  if (ancestors.has(value)) {
    throw new TypeError("TailorKit scope values may not contain cycles.");
  }
  ancestors.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError("TailorKit scope arrays must be standard arrays.");
    }
    if (value.length > maximumArrayLength) {
      throw new TypeError(
        `TailorKit scope arrays may contain at most ${maximumArrayLength} items.`,
      );
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== value.length + 1 ||
      !ownKeys.includes("length") ||
      ownKeys.some((key) => typeof key !== "string")
    ) {
      throw new TypeError("TailorKit scope arrays must be dense and have no extra properties.");
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("TailorKit scope arrays must contain enumerable data items.");
      }
      result.push(normalizeJsonValue(descriptor.value, depth + 1, false, ancestors, countNode));
    }
    ancestors.delete(value);
    return Object.freeze(result);
  }

  if (!isPlainRecord(value)) {
    throw new TypeError("TailorKit scope objects must be plain JSON objects.");
  }
  const entries = getRecordEntries(value, "TailorKit scope objects must contain data properties.");
  if (isRoot && entries.length === 0) {
    throw new TypeError("TailorKit scope values must be nonempty plain JSON objects.");
  }
  if (entries.length > maximumObjectKeys) {
    throw new TypeError(
      `TailorKit scope objects may contain at most ${maximumObjectKeys} properties.`,
    );
  }
  const result = Object.fromEntries(
    entries
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, child]) => [
        key,
        normalizeJsonValue(child, depth + 1, false, ancestors, countNode),
      ]),
  );
  ancestors.delete(value);
  return Object.freeze(result);
}

function getRecordEntries(value: object, errorMessage: string): [string, unknown][] {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new TypeError(errorMessage);
  }
  const entries: [string, unknown][] = [];
  for (const key of ownKeys as string[]) {
    if (key === "__proto__") {
      throw new TypeError('TailorKit scope property names may not be "__proto__".');
    }
    if (key.length === 0 || key.length > maximumKeyLength) {
      throw new TypeError(
        `TailorKit scope property names must be 1 to ${maximumKeyLength} characters.`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(errorMessage);
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function assertPlainRecord(value: unknown, errorMessage: string): asserts value is object {
  if (!isPlainRecord(value)) {
    throw new TypeError(errorMessage);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
