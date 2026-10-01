import { AppError, defineApp, eq, mutation, query } from "@tailorkit/apps-server";
import { z } from "zod";
import { todos } from "./schema";

export default defineApp({
  list: query({
    args: z.object({}),
    handler: ({ db }) => db.select().from(todos).orderBy(todos.id).limit(1000).all(),
  }),
  add: mutation({
    args: z.object({ text: z.string().trim().min(1).max(500) }),
    handler: ({ db, args }) =>
      db
        .insert(todos)
        .values({ id: crypto.randomUUID(), text: args.text, done: false })
        .returning()
        .get()!,
  }),
  toggle: mutation({
    args: z.object({ id: z.string() }),
    handler: ({ db, args }) => {
      const todo = db.select().from(todos).where(eq(todos.id, args.id)).get();
      if (!todo) throw new AppError("NOT_FOUND", "Todo does not exist");
      db.update(todos).set({ done: !todo.done }).where(eq(todos.id, todo.id)).run();
      return null;
    },
  }),
  remove: mutation({
    args: z.object({ id: z.string() }),
    handler: ({ db, args }) => {
      db.delete(todos).where(eq(todos.id, args.id)).run();
      return null;
    },
  }),
});
