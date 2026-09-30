import { StorageError } from "../errors";
/** Stable JSON is also the mutation fingerprint. Reject lossy JSON instead of storing a different result. */
export function json(value: unknown): string {
  function normalize(value: unknown): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(normalize);
    }
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(
        Object.keys(value)
          .toSorted()
          .map((key) => [key, normalize((value as Record<string, unknown>)[key])]),
      );
    }
    throw new StorageError("BAD_REQUEST", "Storage inputs and outputs must be JSON values");
  }
  return JSON.stringify(normalize(value));
}
