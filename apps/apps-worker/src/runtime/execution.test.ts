import { defineRelations, sql } from "drizzle-orm";
import { sqliteView } from "drizzle-orm/sqlite-core";
import { databaseScope } from "./database/driver";
import { Effect } from "effect";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import {
  table,
  text,
  boolean,
  eq,
  defineServer,
  defineDatabase,
  query,
  mutation,
  tk,
  AppError,
} from "@tailorkit/app/server";
import { createExecution } from "./execution";
import type { Persistence } from "./database/driver";

const todos = table("todos", {
  id: text().primaryKey(),
  title: text().notNull(),
  done: boolean().notNull().default(false),
});
const users = table("users", { id: text().primaryKey(), title: text().notNull() });
const viewColumns = () => ({
  id: text().primaryKey(),
  title: text().notNull(),
  done: boolean().notNull(),
});
const identity = {
  userId: "user",
  projectId: "project",
  appId: "app",
  installationId: "installation",
  deploymentId: "deployment",
  expiresAt: Date.now() + 300_000,
};
const connections: DatabaseSync[] = [];
afterEach(() => {
  for (const db of connections) db.close();
  connections.length = 0;
});
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  connections.push(sqlite);
  // Disposable schema setup, not app migration distribution.
  sqlite.exec(
    "CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0); CREATE TABLE users (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
  );
  const persistence: Persistence = {
    execute(sql, params) {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      const rows = statement.columns().length
        ? (statement.all(...(params as never[])) as unknown as unknown[][])
        : (statement.run(...(params as never[])), []);
      return {
        columns: statement.columns().map((column) => column.name),
        rows,
        changes: Number((sqlite.prepare("SELECT changes() AS n").get() as { n: number }).n),
      };
    },
    transaction(run) {
      sqlite.exec("BEGIN");
      try {
        const result = run();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const app = defineServer({
    list: query({ args: z.object({}), handler: ({ db }) => db.select().from(todos).all() }),
    failedRead: query({
      args: z.object({}),
      handler: ({ db }) => {
        db.select().from(todos).all();
        throw new AppError("FORBIDDEN", "Read denied");
      },
    }),
    joined: query({
      args: z.object({}),
      handler: ({ db }) => db.select().from(todos).leftJoin(users, eq(users.id, todos.id)).all(),
    }),
    add: mutation({
      args: z.object({ id: z.string(), title: z.string() }),
      handler: ({ db, args }) => db.insert(todos).values(args).returning().all(),
    }),
    fail: mutation({
      args: z.object({}),
      handler: ({ db }) => {
        db.insert(todos).values({ id: "fail", title: "rollback" }).run();
        throw new Error("failed");
      },
    }),
    oversized: mutation({
      args: z.object({}),
      handler: ({ db }) => {
        db.insert(todos).values({ id: "large", title: "rollback" }).run();
        return "🧵".repeat(300_000);
      },
    }),
    noop: mutation({
      args: z.object({}),
      handler: ({ db }) => db.delete(todos).where(eq(todos.id, "missing")).run(),
    }),
    optionalArgs: mutation({ args: z.unknown().optional(), handler: ({ args }) => args ?? null }),
    unserializable: tk.mutation.input(z.enum(["bigint", "cycle"])).handler(({ input, db }) => {
      db.insert(todos).values({ id: input, title: "rollback" }).run();
      if (input === "bigint") return 1n;
      const value: { self?: unknown } = {};
      value.self = value;
      return value;
    }),
    invalidResult: tk.mutation
      .output(z.object({ ok: z.literal(true) }))
      .handler(({ input, db }) => {
        expect(input).toBeUndefined();
        db.insert(todos).values({ id: "invalid", title: "rollback" }).run();
        return { ok: false } as unknown as { ok: true };
      }),
  });
  return { sqlite, persistence, execution: createExecution(app, persistence) };
}
it("distinguishes omitted and null mutation arguments when checking a replay receipt", () => {
  const { execution } = fixture();
  const requestId = crypto.randomUUID();
  expect(execution.mutate({ name: "optionalArgs", requestId }, identity).value).toBeNull();
  expect(() => execution.mutate({ name: "optionalArgs", args: null, requestId }, identity)).toThrow(
    "Mutation ID was already used for different arguments or identity",
  );
});
it("executes typed Drizzle operations and tracks read tables including empty joins", () => {
  const { execution } = fixture();
  expect(execution.query({ name: "list", args: {} }, identity)).toEqual({
    value: [],
    tables: ["todos"],
  });
  expect(execution.query({ name: "joined", args: {} }, identity).tables.sort()).toEqual([
    "todos",
    "users",
  ]);
  const accepted = execution.mutate(
    { name: "add", args: { id: "1", title: "hello" }, requestId: crypto.randomUUID() },
    identity,
  );
  expect(accepted).toMatchObject({
    committed: true,
    tables: ["todos"],
    value: [{ id: "1", title: "hello", done: false }],
  });
  expect(execution.query({ name: "list", args: {} }, identity).value).toEqual(accepted.value);
});
it.each([
  { name: "query builder", view: sqliteView("todo_view").as((qb) => qb.select().from(todos)) },
  { name: "raw SQL", view: sqliteView("todo_view", viewColumns()).as(sql`SELECT * FROM todos`) },
  { name: "existing", view: sqliteView("todo_view", viewColumns()).existing() },
])("tracks any table write for $name relational views without their base table", ({ view }) => {
  const { persistence, sqlite, execution: mutations } = fixture();
  sqlite.exec(
    "CREATE VIEW todo_view AS SELECT * FROM todos; INSERT INTO users VALUES ('1', 'Author')",
  );
  const directDatabase = defineDatabase({ relations: defineRelations({ view }) });
  const nestedDatabase = defineDatabase({
    relations: defineRelations({ users, view }, (r) => ({
      users: { todos: r.many.view({ from: r.users.id, to: r.view.id }) },
    })),
  });
  const execution = createExecution(
    defineServer({
      direct: tk.query
        .database(directDatabase)
        .handler(({ db }) => db.query.view.findMany().sync()),
      nested: tk.query
        .database(nestedDatabase)
        .handler(({ db }) => db.query.users.findMany({ with: { todos: true } }).sync()),
    }),
    persistence,
  );
  expect(execution.query({ name: "direct" }, identity)).toEqual({ value: [], tables: ["*"] });
  expect(execution.query({ name: "nested" }, identity)).toEqual({
    value: [{ id: "1", title: "Author", todos: [] }],
    tables: ["users", "*"],
  });
  const inserted = mutations.mutate(
    { name: "add", args: { id: "1", title: "hello" }, requestId: crypto.randomUUID() },
    identity,
  );
  expect(inserted.tables).toEqual(["todos"]);
  expect(execution.query({ name: "direct" }, identity).value).toEqual(inserted.value);
  expect(execution.query({ name: "nested" }, identity).value).toEqual([
    { id: "1", title: "Author", todos: inserted.value },
  ]);
});
it("rolls back all writes and receipts when handlers or result validation fail", () => {
  const { execution, sqlite } = fixture();
  for (const name of ["fail", "invalidResult"])
    expect(() =>
      execution.mutate(
        { name, args: name === "fail" ? {} : undefined, requestId: crypto.randomUUID() },
        identity,
      ),
    ).toThrow();
  expect(execution.query({ name: "list", args: {} }, identity).value).toEqual([]);
  expect(sqlite.prepare("SELECT count(*) AS n FROM tailorkit_receipts").get()).toMatchObject({
    n: 0,
  });
});
it("deduplicates accepted writes and rejects reused IDs with different identity or arguments", () => {
  const { execution } = fixture();
  const input = { name: "add", args: { id: "1", title: "hello" }, requestId: crypto.randomUUID() };
  execution.mutate(input, identity);
  expect(execution.mutate(input, identity).committed).toBe(false);
  expect(() =>
    execution.mutate({ ...input, args: { ...input.args, title: "other" } }, identity),
  ).toThrow("already used");
  expect(() => execution.mutate(input, { ...identity, userId: "other" })).toThrow("already used");
  expect((execution.query({ name: "list", args: {} }, identity).value as unknown[]).length).toBe(1);
});
it("validates input, function kind and expiry before execution", () => {
  const { execution } = fixture();
  expect(() => execution.query({ name: "add", args: {} }, identity)).toThrow("not found");
  expect(() => execution.query({ name: "list", args: {} }, { ...identity, expiresAt: 1 })).toThrow(
    "expired",
  );
  expect(() =>
    execution.mutate({ name: "add", args: {}, requestId: crypto.randomUUID() }, identity),
  ).toThrow("arguments");
});
it("does not invalidate a table for a mutation that changes no rows", () => {
  const { execution } = fixture();
  expect(
    execution.mutate({ name: "noop", args: {}, requestId: crypto.randomUUID() }, identity).tables,
  ).toEqual([]);
});
it("rejects async handlers and revokes their database scope before continuations run", async () => {
  const { persistence, sqlite } = fixture();
  let lateError: unknown;
  const bad = createExecution(
    defineServer({
      bad: {
        kind: "mutation",
        args: z.object({}),
        handler: async (ctx: {
          db: Parameters<Parameters<typeof mutation>[0]["handler"]>[0]["db"];
        }) => {
          ctx.db.insert(todos).values({ id: "early", title: "rollback" }).run();
          await Promise.resolve();
          try {
            ctx.db.insert(todos).values({ id: "late", title: "outside" }).run();
          } catch (error) {
            lateError = error;
          }
        },
      },
    }),
    persistence,
  );
  expect(() =>
    bad.mutate({ name: "bad", args: {}, requestId: crypto.randomUUID() }, identity),
  ).toThrow("synchronous");
  await Promise.resolve();
  expect(lateError).toBeInstanceOf(Error);
  expect(sqlite.prepare("SELECT count(*) AS n FROM todos").get()).toMatchObject({ n: 0 });
});

it("allows large results without a custom transport limit", () => {
  const { execution, sqlite } = fixture();
  const result = execution.mutate(
    { name: "oversized", args: {}, requestId: crypto.randomUUID() },
    identity,
  );
  expect(result.committed).toBe(true);
  expect(sqlite.prepare("SELECT count(*) AS n FROM tailorkit_receipts").get()).toMatchObject({
    n: 1,
  });
});

it("returns structured results and per-call table metadata on success and errors", () => {
  const { execution } = fixture();
  const read = Effect.runSync(execution.call("query", { name: "list", args: {} }, identity));
  expect(read).toMatchObject({ tables: ["todos"], committed: false, result: { ok: true } });
  expect(read.result).toEqual({ ok: true, value: [] });
  const failedRead = Effect.runSync(
    execution.call("query", { name: "failedRead", args: {} }, identity),
  );
  expect(failedRead).toMatchObject({
    tables: ["todos"],
    committed: false,
    result: { ok: false, error: { code: "FORBIDDEN" } },
  });
  expect(failedRead.result.ok ? undefined : failedRead.result.error).toEqual({
    code: "FORBIDDEN",
    message: "Read denied",
  });
  const failedWrite = Effect.runSync(
    execution.call(
      "mutation",
      { name: "fail", args: {}, requestId: crypto.randomUUID() },
      identity,
    ),
  );
  expect(failedWrite).toMatchObject({
    tables: ["todos"],
    committed: false,
    result: { ok: false, error: { code: "INTERNAL_SERVER_ERROR" } },
  });
  expect(execution.query({ name: "list", args: {} }, identity).value).toEqual([]);
  expect(Effect.runSync(execution.call("query", { name: "missing" }, identity)).tables).toEqual([]);
  expect(
    Effect.runSync(execution.call("mutation", { name: "add", args: {} }, identity)).result,
  ).toMatchObject({
    ok: false,
    error: { code: "BAD_REQUEST" },
  });
});

it.each(["bigint", "cycle"])(
  "rolls back writes and receipts before returning an unserializable %s",
  (args) => {
    const { execution, sqlite } = fixture();
    const outcome = Effect.runSync(
      execution.call(
        "mutation",
        { name: "unserializable", args, requestId: crypto.randomUUID() },
        identity,
      ),
    );
    expect(outcome).toMatchObject({
      result: { ok: false, error: { code: "INTERNAL_SERVER_ERROR" } },
      tables: ["todos"],
      committed: false,
    });
    expect(execution.query({ name: "list", args: {} }, identity).value).toEqual([]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM tailorkit_receipts").get()).toMatchObject({
      n: 0,
    });
  },
);

it("runs action database calls locally and notifies only committed writes before the action finishes", async () => {
  const { persistence, sqlite } = fixture();
  const records = {
    list: tk.query.handler(({ db }) => db.select().from(todos).all()),
    add: tk.mutation
      .input(z.object({ id: z.string(), title: z.string() }))
      .handler(({ input, db }) => db.insert(todos).values(input).returning().all()),
    fail: tk.mutation.handler(({ db }) => {
      db.insert(todos).values({ id: "rolled-back", title: "discard" }).run();
      throw new AppError("CONFLICT", "Rollback");
    }),
  };
  let release!: () => void;
  const external = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const committed = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const requestId = crypto.randomUUID();
  const app = defineServer({
    records,
    run: tk.action.functions({ records }).handler(async ({ queries, mutations }) => {
      const input = { id: "committed", title: "local" };
      await mutations.records.add(input, { requestId });
      await mutations.records.add(input, { requestId });
      await expect(mutations.records.fail()).rejects.toMatchObject({ code: "CONFLICT" });
      for (let i = 0; i < 100; i++) await queries.records.list();
      await external;
      return queries.records.list();
    }),
  });
  const execution = createExecution(app, persistence);
  const notify = vi.fn(async (tables: string[]) => {
    expect(tables).toEqual(["todos"]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM tailorkit_receipts").get()).toMatchObject({
      n: 1,
    });
    ready();
  });
  let finished = false;
  const running = Effect.runPromise(
    execution.action(
      { name: "run" },
      identity,
      { committed: notify },
      new AbortController().signal,
    ),
  ).then((result) => {
    finished = true;
    return result;
  });
  await committed;
  expect(finished).toBe(false);
  expect(execution.query({ name: "records.list" }, identity).value).toMatchObject([
    { id: "committed" },
  ]);
  release();
  expect(await running).toMatchObject({
    result: { ok: true, value: [{ id: "committed" }] },
    tables: [],
    committed: false,
  });
  expect(notify).toHaveBeenCalledOnce();
});

it("runs nested relational queries and preserves scope, permissions and invalidation", () => {
  const { sqlite, persistence } = fixture();
  const relations = defineRelations({ users, todos }, (r) => ({
    users: { todos: r.many.todos({ from: r.users.id, to: r.todos.id }) },
    todos: { user: r.one.users({ from: r.todos.id, to: r.users.id }) },
  }));
  const database = defineDatabase({ relations });
  const app = defineServer({
    list: tk.query
      .database(database)
      .handler(({ db }) =>
        db.query.users.findMany({ with: { todos: true }, orderBy: { id: "asc" } }).sync(),
      ),
    first: query({
      database,
      args: z.undefined(),
      handler: ({ db }) =>
        db.query.todos.findFirst({ where: { id: "one" }, with: { user: true } }).sync() ?? null,
    }),
    absent: tk.query
      .database(database)
      .handler(({ db }) => db.query.todos.findFirst({ where: { id: "missing" } }).sync() ?? null),
    insert: tk.mutation
      .database(database)
      .input(z.string())
      .handler(({ db, input }) => {
        db.insert(todos).values({ id: input, title: "Nested todo", done: true }).run();
        return db.query.todos.findFirst({ where: { id: input }, with: { user: true } }).sync();
      }),
    writeInQuery: tk.query.database(database).handler(({ db }) => {
      // @ts-expect-error Verify runtime enforcement even if a caller bypasses the type restriction.
      db.insert(todos).values({ id: "forbidden", title: "No" }).run();
      return null;
    }),
  });
  const execution = createExecution(app, persistence);
  expect(execution.query({ name: "list" }, identity)).toEqual({
    value: [],
    tables: ["users", "todos"],
  });
  sqlite.exec("INSERT INTO users VALUES ('one', 'Author')");
  const inserted = execution.mutate(
    { name: "insert", args: "one", requestId: crypto.randomUUID() },
    identity,
  );
  const todo = {
    id: "one",
    title: "Nested todo",
    done: true,
    user: { id: "one", title: "Author" },
  };
  expect(inserted.value).toEqual(todo);
  expect(inserted.tables).toEqual(["todos"]);
  expect(execution.query({ name: "first" }, identity).value).toEqual(todo);
  expect(execution.query({ name: "list" }, identity).value).toEqual([
    { id: "one", title: "Author", todos: [{ id: "one", title: "Nested todo", done: true }] },
  ]);
  expect(execution.query({ name: "absent" }, identity).value).toBeNull();
  expect(() => execution.query({ name: "writeInQuery" }, identity)).toThrow("Queries cannot write");
  const scope = databaseScope(persistence, false, relations);
  const usersQuery = scope.db.query.users;
  if (!usersQuery) {
    throw new Error("Missing users query");
  }
  const prepared = usersQuery.findMany().prepare();
  scope.close();
  expect(() => prepared.all()).toThrow("Database scope has ended");
});
