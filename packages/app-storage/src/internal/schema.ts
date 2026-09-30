import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { StoreSchema } from "../schema";

export function drizzleSchema(schema: StoreSchema) {
  return Object.fromEntries(
    Object.entries(schema).map(([name, fields]) => {
      const columns: Record<
        string,
        ReturnType<typeof text> | ReturnType<typeof integer> | ReturnType<typeof real>
      > = {};
      for (const [key, field] of Object.entries(fields)) {
        let column;
        if (field.kind === "text") {
          column = text(key);
        } else if (field.kind === "number") {
          column = real(key);
        } else {
          column = integer(
            key,
            field.kind === "boolean" ? { mode: "boolean" } : { mode: "number" },
          );
        }
        if (!field.nullable) {
          column = column.notNull();
        }
        if (field.primaryKey) {
          column = column.primaryKey();
        }
        if (field.unique) {
          column = column.unique();
        }
        columns[key] = column;
      }
      return [name, sqliteTable(name, columns)];
    }),
  );
}
// Runtime-owned tables are included in CLI-generated migrations too.
export const metadataTables = {
  tk_receipts: sqliteTable("tk_receipts", {
    key: text().primaryKey(),
    fingerprint: text().notNull(),
    result: text().notNull(),
  }),
  tk_state: sqliteTable("tk_state", {
    key: text().primaryKey(),
    value: integer().notNull(),
  }),
};
