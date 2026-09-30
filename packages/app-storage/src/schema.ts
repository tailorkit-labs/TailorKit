export type FieldKind = "text" | "integer" | "number" | "boolean";
export interface Field<K extends FieldKind = FieldKind, N extends boolean = boolean> {
  readonly kind: K;
  readonly nullable: N;
  readonly primaryKey: boolean;
  readonly unique: boolean;
}
interface FieldOptions<N extends boolean> {
  nullable?: N;
  primaryKey?: boolean;
  unique?: boolean;
}
interface FieldFactory<K extends FieldKind> {
  (options: FieldOptions<true> & { nullable: true }): Field<K, true>;
  (options?: FieldOptions<false>): Field<K, false>;
}
function field<K extends FieldKind>(kind: K): FieldFactory<K> {
  return ((options: FieldOptions<boolean> = {}) =>
    Object.freeze({
      kind,
      nullable: options.nullable ?? false,
      primaryKey: options.primaryKey ?? false,
      unique: options.unique ?? false,
    })) as FieldFactory<K>;
}
export const fields = Object.freeze({
  text: field("text"),
  integer: field("integer"),
  number: field("number"),
  boolean: field("boolean"),
});
export type TableDefinition = Readonly<Record<string, Field>>;
export type StoreSchema = Readonly<Record<string, TableDefinition>>;
const identifier = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/u;
export function defineSchema<const S extends StoreSchema>(schema: S): S {
  for (const [name, columns] of Object.entries(schema)) {
    if (!identifier.test(name) || name.startsWith("tk_") || name.startsWith("sqlite_")) {
      throw new Error(`Invalid or reserved table name: ${name}`);
    }
    let primaryKeys = 0;
    for (const [column, definition] of Object.entries(columns)) {
      if (!identifier.test(column)) {
        throw new Error(`Invalid column name: ${column}`);
      }
      if (definition.primaryKey) {
        primaryKeys++;
        if (definition.nullable) {
          throw new Error("Primary keys cannot be nullable");
        }
      }
    }
    if (primaryKeys !== 1) {
      throw new Error(`Table ${name} requires exactly one primary key`);
    }
    Object.freeze(columns);
  }
  return Object.freeze(schema);
}
type FieldValue<F extends Field> =
  | { text: string; integer: number; number: number; boolean: boolean }[F["kind"]]
  | (true extends F["nullable"] ? null : never);
export type Row<T extends TableDefinition> = { -readonly [K in keyof T]: FieldValue<T[K]> };
export interface SelectOptions<R> {
  where?: Partial<R>;
  orderBy?: { field: keyof R & string; direction?: "asc" | "desc" };
  limit?: number;
}
export interface ReadTable<R> {
  all(options?: SelectOptions<R>): R[];
  first(where: Partial<R>): R | null;
}
export interface WriteTable<R> extends ReadTable<R> {
  insert(row: R): R;
  update(where: Partial<R>, values: Partial<R>): number;
  delete(where: Partial<R>): number;
}
export interface ReadDatabase<S extends StoreSchema> {
  table<K extends keyof S & string>(name: K): ReadTable<Row<S[K]>>;
}
export interface WriteDatabase<S extends StoreSchema> {
  table<K extends keyof S & string>(name: K): WriteTable<Row<S[K]>>;
}
