import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { Row, StoreSchema, TableDefinition, WriteDatabase } from "../schema";
import { StorageError } from "../errors";
import type { SqlDriver } from "./driver";
import { drizzleSchema } from "./schema";

export function databaseScope(
  schema: StoreSchema,
  driver: SqlDriver,
  writable: boolean,
  reads: Set<string>,
  writes: Set<string>,
) {
  // Use Drizzle's dialect and parameter binding; execution remains synchronous via the provider.
  const compiler = drizzle(() => Promise.reject(new Error("Use the synchronous storage driver")));
  const tables = drizzleSchema(schema);
  let active = true;
  function check(write = false) {
    if (!active) {
      throw new StorageError("BAD_REQUEST", "Database scope has ended");
    }
    if (write && !writable) {
      throw new StorageError("FORBIDDEN", "Queries cannot write");
    }
  }
  const db: WriteDatabase<StoreSchema> = {
    table(name) {
      check();
      const table = tables[name];
      const fields = schema[name];
      if (!table || !fields) {
        throw new StorageError("BAD_REQUEST", "Unknown table");
      }
      const column = (key: string) => {
        if (!Object.hasOwn(fields, key)) {
          throw new StorageError("BAD_REQUEST", "Unknown column");
        }
        const selected = table[key];
        if (!selected) {
          throw new StorageError("BAD_REQUEST", "Unknown column");
        }
        return selected;
      };
      const whereSQL = (where: Record<string, unknown> = {}): SQL | undefined =>
        and(
          ...Object.entries(where).map(([key, value]) => {
            validateValue(key, value);
            return value === null ? isNull(column(key)) : eq(column(key), value);
          }),
        );
      function validateValue(key: string, value: unknown) {
        column(key);
        const field = fields?.[key];
        if (!field) {
          throw new StorageError("BAD_REQUEST", "Unknown column");
        }
        if (value === null && field.nullable) {
          return;
        }
        const expected = {
          text: "string",
          boolean: "boolean",
          integer: "number",
          number: "number",
        }[field.kind];
        if (
          typeof value !== expected ||
          (typeof value === "number" &&
            (!Number.isFinite(value) || (field.kind === "integer" && !Number.isSafeInteger(value))))
        ) {
          throw new StorageError("BAD_REQUEST", `Invalid value for ${name}.${key}`);
        }
      }
      const run = (query: { toSQL(): { sql: string; params: unknown[] } }, write: boolean) => {
        check(write);
        const compiled = query.toSQL();
        const rows = driver.execute(compiled.sql, compiled.params);
        if (write) {
          if (rows.length) {
            writes.add(name);
          }
        } else {
          reads.add(name);
        }
        return rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              fields[key]?.kind === "boolean" && value !== null ? Boolean(value) : value,
            ]),
          ),
        ) as Row<TableDefinition>[];
      };
      const all = (
        options: {
          where?: Record<string, unknown>;
          orderBy?: { field: string; direction?: "asc" | "desc" };
          limit?: number;
        } = {},
      ) => {
        check();
        let query = compiler.select().from(table).where(whereSQL(options.where)).$dynamic();
        if (options.orderBy) {
          query = query.orderBy(
            (options.orderBy.direction === "desc" ? desc : asc)(column(options.orderBy.field)),
          );
        }
        if (options.limit !== undefined) {
          if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 10_000) {
            throw new StorageError("BAD_REQUEST", "Limit must be between 1 and 10000");
          }
          query = query.limit(options.limit);
        }
        return run(query, false);
      };
      return {
        all,
        first(where) {
          return all({ where, limit: 1 })[0] ?? null;
        },
        insert(row) {
          check(true);
          for (const key of Object.keys(fields)) {
            validateValue(key, row[key]);
          }
          for (const key of Object.keys(row)) {
            column(key);
          }
          const inserted = run(compiler.insert(table).values(row).returning(), true)[0];
          if (!inserted) {
            throw new StorageError("INTERNAL_SERVER_ERROR", "Insert returned no row");
          }
          return inserted;
        },
        update(where, values) {
          check(true);
          if (!Object.keys(where).length) {
            throw new StorageError("BAD_REQUEST", "Update requires a filter");
          }
          for (const [key, value] of Object.entries(values)) {
            validateValue(key, value);
          }
          if (!Object.keys(values).length) {
            return 0;
          }
          return run(compiler.update(table).set(values).where(whereSQL(where)).returning(), true)
            .length;
        },
        delete(where) {
          check(true);
          if (!Object.keys(where).length) {
            throw new StorageError("BAD_REQUEST", "Delete requires a filter");
          }
          return run(compiler.delete(table).where(whereSQL(where)).returning(), true).length;
        },
      };
    },
  };
  return {
    db,
    close() {
      active = false;
    },
  };
}
