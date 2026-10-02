import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  real as sqliteReal,
} from "drizzle-orm/sqlite-core";
import type { ColumnBuilderBase } from "drizzle-orm";

export function table<N extends string, C extends Record<string, ColumnBuilderBase>>(
  name: N,
  columns: C,
) {
  if (
    !/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/u.test(name) ||
    name.startsWith("sqlite_") ||
    name.startsWith("tailorkit_")
  )
    throw new Error("Invalid or reserved table name");
  return sqliteTable(name, columns);
}

export const text = (name = "") => sqliteText(name);
export const integer = (name = "") => sqliteInteger(name);
export const real = (name = "") => sqliteReal(name);
export const boolean = (name = "") => sqliteInteger(name, { mode: "boolean" });
export {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  asc,
  desc,
  count,
  isNull,
  isNotNull,
  inArray,
} from "drizzle-orm";
