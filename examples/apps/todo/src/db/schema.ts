import { boolean, table, text } from "tailorkit/server";
import { z } from "zod";

export const todos = table("todos", {
  id: text().primaryKey(),
  text: text().notNull(),
  done: boolean().notNull().default(false),
  another: text(),
});

export type Todo = typeof todos.$inferSelect;

export const todoText = z.string().trim().min(1).max(500);
export const todoId = z.object({ id: z.uuid() });
