import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { TailorKitScope } from "./types";

const maximumScopeKeys = 32;
const maximumScopeKeyLength = 64;
const maximumScopeValueLength = 255;

export async function validateTailorKitScope(
  scopeSchema: StandardSchemaV1,
  value: unknown,
): Promise<TailorKitScope> {
  const result = await scopeSchema["~standard"].validate(value);
  if (result.issues) {
    throw new TypeError(
      "TailorKit authenticate() returned a scope that failed scopeSchema validation.",
    );
  }

  return normalizeTailorKitScope(result.value);
}

export function normalizeTailorKitScope(value: unknown): TailorKitScope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("TailorKit scope must be a flat record of nonempty strings.");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("TailorKit scope must be a flat record of nonempty strings.");
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length === 0 || ownKeys.length > maximumScopeKeys) {
    throw new TypeError(`TailorKit scope must contain between 1 and ${maximumScopeKeys} fields.`);
  }

  const entries: [string, string][] = [];
  for (const key of ownKeys) {
    if (typeof key !== "string" || key.length === 0 || key.length > maximumScopeKeyLength) {
      throw new TypeError(
        `TailorKit scope field names must be strings of 1 to ${maximumScopeKeyLength} characters.`,
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError("TailorKit scope fields must be enumerable data properties.");
    }

    const field = descriptor.value;
    if (typeof field !== "string" || field.length === 0 || field.length > maximumScopeValueLength) {
      throw new TypeError(
        `TailorKit scope values must be nonempty strings of at most ${maximumScopeValueLength} characters.`,
      );
    }

    entries.push([key, field]);
  }

  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.freeze(Object.fromEntries(entries));
}
