import { boolean, table, text } from "@tailorkit/apps-server";

export const todos = table("todos", {
  id: text().primaryKey(),
  text: text().notNull(),
  done: boolean().notNull().default(false),
});
