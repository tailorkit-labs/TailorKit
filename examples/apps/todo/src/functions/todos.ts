import { AppError, eq, tk } from "tailorkit/server";
import { z } from "zod";
import { db as database, todoId, todos, todoText } from "../db";

export const list = tk.query
  .database(database)
  .handler(({ db }) => db.query.todos.findMany({ orderBy: { id: "asc" }, limit: 1000 }).sync());

export const add = tk.mutation
  .database(database)
  .input(z.object({ text: todoText }))
  .handler(({ db, input }) => {
    const todo = db
      .insert(todos)
      .values({ id: crypto.randomUUID(), text: input.text, done: false })
      .returning()
      .get();
    if (!todo) throw new AppError("INTERNAL_SERVER_ERROR", "Could not create todo");
    return todo;
  });

export const update = tk.mutation
  .database(database)
  .input(todoId.extend({ text: todoText }))
  .handler(({ db, input }) => {
    const todo = db
      .update(todos)
      .set({ text: input.text })
      .where(eq(todos.id, input.id))
      .returning()
      .get();
    if (!todo) throw new AppError("NOT_FOUND", "Todo does not exist");
    return todo;
  });

export const toggle = tk.mutation
  .database(database)
  .input(todoId)
  .handler(({ db, input }) => {
    const todo = db.select().from(todos).where(eq(todos.id, input.id)).get();
    if (!todo) throw new AppError("NOT_FOUND", "Todo does not exist");
    db.update(todos).set({ done: !todo.done }).where(eq(todos.id, todo.id)).run();
    return null;
  });

export const remove = tk.mutation
  .database(database)
  .input(todoId)
  .handler(({ db, input }) => {
    db.delete(todos).where(eq(todos.id, input.id)).run();
    return null;
  });
