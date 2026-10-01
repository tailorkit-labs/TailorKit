import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vite-plus/test";
import { z } from "zod";
import { table, text, boolean, eq, defineApp, query, mutation } from "../index";
import { createExecution } from "./execution";
import type { Persistence } from "../database/driver";

const todos = table("todos", {
  id: text().primaryKey(),
  title: text().notNull(),
  done: boolean().notNull().default(false),
});
const users = table("users", { id: text().primaryKey(), title: text().notNull() });
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
  const app = defineApp({
    list: query({ args: z.object({}), handler: ({ db }) => db.select().from(todos).all() }),
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
    invalidResult: mutation({
      args: z.object({}),
      result: z.object({ ok: z.literal(true) }),
      handler: ({ db }) => {
        db.insert(todos).values({ id: "invalid", title: "rollback" }).run();
        return { ok: false } as unknown as { ok: true };
      },
    }),
  });
  return { sqlite, persistence, execution: createExecution(app, persistence) };
}
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
it("rolls back all writes and receipts when handlers or result validation fail", () => {
  const { execution, sqlite } = fixture();
  for (const name of ["fail", "invalidResult"])
    expect(() =>
      execution.mutate({ name, args: {}, requestId: crypto.randomUUID() }, identity),
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
    defineApp({
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

it("rolls back writes and receipts when a UTF-8 response exceeds the transport limit", () => {
  const { execution, sqlite } = fixture();
  expect(() =>
    execution.mutate({ name: "oversized", args: {}, requestId: crypto.randomUUID() }, identity),
  ).toThrow("Function result exceeds 1 MiB");
  expect(execution.query({ name: "list", args: {} }, identity).value).toEqual([]);
  expect(sqlite.prepare("SELECT count(*) AS n FROM tailorkit_receipts").get()).toMatchObject({
    n: 0,
  });
});
