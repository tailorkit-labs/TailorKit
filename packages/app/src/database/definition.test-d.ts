import { defineRelations } from "drizzle-orm";
import { z } from "zod";
import { defineDatabase, table, text, boolean, tk, query, mutation, defineServer } from "../server";
import { createApi } from "../client/reference";
import type { Client } from "../client/connection";

const users = table("users", { id: text().primaryKey() });
const posts = table("posts", {
  id: text().primaryKey(),
  userId: text().notNull(),
  published: boolean().notNull(),
});
const relations = defineRelations({ users, posts }, (r) => ({
  users: { posts: r.many.posts({ from: r.users.id, to: r.posts.userId }) },
  posts: { user: r.one.users({ from: r.posts.userId, to: r.users.id }) },
}));
const database = defineDatabase({ relations });
const read = tk.query
  .database(database)
  .input(z.object({ id: z.string() }))
  .handler(({ db, input }) => {
    // @ts-expect-error Queries cannot write even with relations configured.
    void db.insert;
    // @ts-expect-error Unknown tables are rejected.
    void db.query.missing;
    const rows = db.query.users.findMany({ where: { id: input.id }, with: { posts: true } }).sync();
    rows satisfies { id: string; posts: { id: string; userId: string; published: boolean }[] }[];
    // @ts-expect-error Relation columns retain their types.
    rows satisfies { id: number }[];
    return rows;
  });
const write = tk.mutation
  .input(z.string())
  .database(database)
  .output(z.boolean())
  .handler(({ db, input }) => {
    db.insert(posts).values({ id: input, userId: "u1", published: true }).run();
    return db.query.posts.findFirst({ where: { id: input } }).sync()?.published ?? false;
  });
const directQuery = query({
  database,
  args: z.undefined(),
  handler: ({ db }) => db.query.users.findMany({ with: { posts: true } }).sync(),
});
const directMutation = mutation({
  database,
  args: z.undefined(),
  handler: ({ db }) => db.query.posts.findFirst().sync(),
});
// @ts-expect-error Actions cannot access a database directly.
tk.action.database(database);
// @ts-expect-error A query cannot return a relational promise; use sync().
tk.query.database(database).handler(({ db }) => db.query.users.findMany());
const app = defineServer({ read, write, directQuery, directMutation });
const api = createApi<typeof app.functions>();
declare const client: Client;
client.query(api.read, { id: "u1" }) satisfies Promise<
  { id: string; posts: { id: string; userId: string; published: boolean }[] }[]
>;
client.mutate(api.write, "p1") satisfies Promise<boolean>;
