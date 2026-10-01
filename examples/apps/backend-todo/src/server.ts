import { AppError, defineApp, eq, mutation, query, action } from "@tailorkit/apps-server";
import { z } from "zod";
import { todos } from "./schema";

const functions = {
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
};

export default defineApp({
  ...functions,
  importTodo: action({
    functions,
    args: z.object({ url: z.url() }),
    async handler(ctx) {
      await ctx.queries.list({});
      const response = await fetch(ctx.args.url, { signal: ctx.signal });
      if (!response.ok) throw new AppError("UNAVAILABLE", "External API failed");
      const data = z
        .object({ title: z.string().trim().min(1).max(500) })
        .parse(await response.json());
      return ctx.mutations.add({ text: data.title });
    },
  }),
});
