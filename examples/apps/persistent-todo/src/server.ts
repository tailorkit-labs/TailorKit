import {
  createFunctions,
  defineSchema,
  defineStore,
  fields,
  StorageError,
} from "@tailorkit/app-storage/server";
import { z } from "zod";

const schema = defineSchema({
  todos: { id: fields.text({ primaryKey: true }), text: fields.text(), done: fields.boolean() },
});
const { query, mutation } = createFunctions(schema);
const todo = z.object({ id: z.string(), text: z.string(), done: z.boolean() });
export default defineStore({
  schema,
  apiVersion: 1,
  functions: {
    list: query({
      input: z.object({}),
      output: z.array(todo),
      handler: ({ db }) => db.table("todos").all({ orderBy: { field: "id" }, limit: 1000 }),
    }),
    add: mutation({
      input: z.object({ text: z.string().trim().min(1).max(500) }),
      output: todo,
      handler: ({ db }, input) =>
        db.table("todos").insert({ id: crypto.randomUUID(), text: input.text, done: false }),
    }),
    toggle: mutation({
      input: z.object({ id: z.string() }),
      output: z.null(),
      handler: ({ db }, input) => {
        const item = db.table("todos").first({ id: input.id });
        if (!item) {
          throw new StorageError("NOT_FOUND", "Todo does not exist");
        }
        db.table("todos").update({ id: item.id }, { done: !item.done });
        return null;
      },
    }),
    remove: mutation({
      input: z.object({ id: z.string() }),
      output: z.null(),
      handler: ({ db }, input) => {
        db.table("todos").delete({ id: input.id });
        return null;
      },
    }),
    seed: mutation({
      input: z.object({}),
      output: z.null(),
      handler: ({ db }) => {
        if (!db.table("todos").first({ id: "welcome" })) {
          db.table("todos").insert({
            id: "welcome",
            text: "Edit this todo in either client",
            done: false,
          });
        }
        return null;
      },
    }),
  },
});
