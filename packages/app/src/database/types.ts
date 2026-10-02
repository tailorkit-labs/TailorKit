import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

type Database = BaseSQLiteDatabase<"sync", { changes: number }>;
export type QueryDatabase = Pick<Database, "select" | "selectDistinct">;
export type MutationDatabase = QueryDatabase & Pick<Database, "insert" | "update" | "delete">;
