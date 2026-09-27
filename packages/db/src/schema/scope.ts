import z from "zod";

export type Scope = Record<string, string>;

export const scopeValueSchema = z.custom<Scope>((value): value is Scope => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.length <= 32 &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        key.length > 0 &&
        key.length <= 64 &&
        !!descriptor &&
        "value" in descriptor &&
        typeof descriptor.value === "string" &&
        descriptor.value.length > 0 &&
        descriptor.value.length <= 255
      );
    })
  );
}, "Scope must be a flat record with 1–32 nonempty string entries.");
