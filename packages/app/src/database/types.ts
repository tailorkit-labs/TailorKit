import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

type Database<R extends AnyRelations> = BaseSQLiteDatabase<
  "sync",
  { changes: number },
  Record<string, never>,
  R
>;
export type QueryDatabase<R extends AnyRelations = EmptyRelations> = Pick<
  Database<R>,
  "select" | "selectDistinct" | "query"
>;
export type MutationDatabase<R extends AnyRelations = EmptyRelations> = QueryDatabase<R> &
  Pick<Database<R>, "insert" | "update" | "delete">;
