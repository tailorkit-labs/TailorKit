import {
  BaseSQLiteDatabase,
  SQLitePreparedQuery,
  SQLiteSession,
  SQLiteSyncDialect,
} from "drizzle-orm/sqlite-core";
import type { PreparedQueryConfig, SQLiteExecuteMethod } from "drizzle-orm/sqlite-core";
import type { SelectedFieldsOrdered } from "drizzle-orm/sqlite-core/query-builders/select.types";
import type { Query } from "drizzle-orm";
import { fillPlaceholders } from "drizzle-orm";
import { makeDefaultQueryMapper } from "drizzle-orm/utils";
import { AppError } from "../errors";
import type { MutationDatabase } from "@tailorkit/app/server";

export interface SqlResult {
  columns: string[];
  rows: unknown[][];
  changes: number;
}
export interface Persistence {
  execute(sql: string, params: unknown[]): SqlResult;
  transaction<T>(run: () => T): T;
}
type Metadata = { type: "select" | "insert" | "update" | "delete"; tables: string[] };

export function databaseScope(driver: Persistence, writable: boolean) {
  const reads = new Set<string>();
  const writes = new Set<string>();
  let active = true;
  class Prepared extends SQLitePreparedQuery<PreparedQueryConfig & { type: "sync" }> {
    constructor(
      query: Query,
      private fields: SelectedFieldsOrdered | undefined,
      method: SQLiteExecuteMethod,
      private mapper: ((rows: unknown[][]) => unknown) | undefined,
      private metadata: Metadata | undefined,
    ) {
      super("sync", method, query);
    }
    private executeSql(values: Record<string, unknown> = {}) {
      if (!active) throw new AppError("BAD_REQUEST", "Database scope has ended");
      if (!this.metadata)
        throw new AppError("BAD_REQUEST", "Use the supported database query builders");
      if (!writable && this.metadata.type !== "select")
        throw new AppError("FORBIDDEN", "Queries cannot write");
      const result = driver.execute(this.query.sql, fillPlaceholders(this.query.params, values));
      for (const table of this.metadata.tables) {
        if (this.metadata.type === "select") reads.add(table);
        else if (result.changes) writes.add(table);
      }
      return result;
    }
    run(values?: Record<string, unknown>) {
      return { changes: this.executeSql(values).changes };
    }
    values(values?: Record<string, unknown>) {
      return this.executeSql(values).rows;
    }
    all(values?: Record<string, unknown>) {
      const result = this.executeSql(values);
      if (this.mapper) return this.mapper(result.rows);
      if (this.fields)
        return makeDefaultQueryMapper<unknown[]>(
          this.fields,
          (this as typeof this & { joinsNotNullableMap?: Record<string, boolean> })
            .joinsNotNullableMap,
        )(result.rows);
      return result.rows.map((row) =>
        Object.fromEntries(result.columns.map((name, index) => [name, row[index]])),
      );
    }
    get(values?: Record<string, unknown>) {
      return (this.all(values) as unknown[])[0];
    }
  }
  class Session extends SQLiteSession<"sync", { changes: number }> {
    prepareQuery(
      query: Query,
      fields: SelectedFieldsOrdered | undefined,
      method: SQLiteExecuteMethod,
      mapper?: (rows: unknown[][]) => unknown,
      metadata?: Metadata,
    ) {
      return new Prepared(query, fields, method, mapper, metadata);
    }
    prepareRelationalQuery(): never {
      throw new AppError("BAD_REQUEST", "Relational query configuration is not supported");
    }
    transaction(): never {
      throw new AppError("BAD_REQUEST", "Mutations already run in an atomic transaction");
    }
  }
  const dialect = new SQLiteSyncDialect();
  const underlying = new BaseSQLiteDatabase<"sync", { changes: number }>(
    "sync",
    dialect,
    new Session(dialect),
    {},
    undefined,
  );
  const db: MutationDatabase = {
    select: underlying.select.bind(underlying),
    selectDistinct: underlying.selectDistinct.bind(underlying),
    insert: underlying.insert.bind(underlying),
    update: underlying.update.bind(underlying),
    delete: underlying.delete.bind(underlying),
  };
  return {
    db,
    reads,
    writes,
    close: () => {
      active = false;
    },
  };
}
