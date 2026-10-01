import { AppError, defineApp, eq, mutation, query, action } from "@tailorkit/apps-server";
import { z } from "zod";
import { todos } from "./schema";
import { api } from "./server.gen";
type Todo = typeof todos.$inferSelect;

export default defineApp({
  importTodo: action({
    args: z.object({ url: z.url() }),
    async handler({ args, runQuery, runMutation, signal }): Promise<Todo> {
      await runQuery(api.list, {});
      const response = await fetch(args.url, { signal });
      if (!response.ok) throw new AppError("UNAVAILABLE", "External API failed");
      const data = z
        .object({ title: z.string().trim().min(1).max(500) })
        .parse(await response.json());
      return runMutation(api.add, { text: data.title });
    },
  }),
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
