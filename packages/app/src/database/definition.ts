import type { AnyRelations } from "drizzle-orm/relations";

export interface DatabaseDefinition<R extends AnyRelations = AnyRelations> {
  readonly relations: R;
}

/** Configure the installation database with Drizzle relations, which also contain its tables. */
export function defineDatabase<const R extends AnyRelations>(definition: DatabaseDefinition<R>) {
  return Object.freeze({ relations: definition.relations });
}
