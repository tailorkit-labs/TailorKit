import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { tk } from "@tailorkit/app/server";
import { defineServer } from "@tailorkit/app/server";
import { createExecution, invocationSchema } from "./execution";
import { createActionExecution } from "./actions";
import type { ActionCalls } from "./actions";
import type { AppDefinition, Identity } from "@tailorkit/app/server";
import type { Invocation } from "@tailorkit/app/protocol";
function actionRunner(app: AppDefinition, calls: ActionCalls) {
  const run = createActionExecution(app);
  return (input: Invocation, identity: Identity, signal?: AbortSignal) =>
    run(input, identity, calls, signal);
}
import type { Persistence } from "./database/driver";

const identity = {
  userId: "u",
  projectId: "p",
  appId: "a",
  installationId: "i",
  deploymentId: "d",
  expiresAt: Date.now() + 300_000,
};
const persistence: Persistence = {
  execute: () => ({ rows: [], columns: [], changes: 0 }),
  transaction: (run) => run(),
};

it("validates and transforms fluent inputs and outputs through the real execution path", () => {
  const app = defineServer({
    transformed: tk.query
      .input(z.object({ value: z.string().transform(Number) }))
      .output(z.string().transform(Number))
      .handler(({ input, identity: viewer }) => {
        expect(viewer.userId).toBe("u");
        expect(input.value).toBe(4);
        return String(input.value + 1);
      }),
    empty: tk.query.handler(({ input }) => {
      expect(input).toBeUndefined();
      return { inferred: "no schema needed" };
    }),
    nullable: tk.query.input(z.null()).handler(({ input }) => input),
    invalid: tk.query.output(z.number().min(10)).handler(() => 1),
  });
  const execute = createExecution(app, persistence);
  expect(execute.query({ name: "transformed", args: { value: "4" } }, identity).value).toBe(5);
  expect(() => execute.query({ name: "transformed", args: { value: 4 } }, identity)).toThrow(
    "Invalid function arguments",
  );
  expect(execute.query({ name: "empty" }, identity).value).toEqual({
    inferred: "no schema needed",
  });
  expect(execute.query(invocationSchema.parse({ name: "empty" }), identity).value).toEqual({
    inferred: "no schema needed",
  });
  for (const args of [{}, null, "unexpected"]) {
    expect(() => execute.query({ name: "empty", args }, identity)).toThrow(
      "Invalid function arguments",
    );
  }
  expect(invocationSchema.parse({ name: "empty", args: undefined })).toEqual({
    name: "empty",
    args: undefined,
  });
  expect(execute.query({ name: "nullable", args: null }, identity).value).toBeNull();
  expect(() => execute.query({ name: "invalid" }, identity)).toThrow("Invalid function result");
});

it("keeps builders immutable and provides typed action calls using registered functions", async () => {
  const functions = { read: tk.query.output(z.string().transform(Number)).handler(() => "4") };
  const base = tk.action.functions(functions).output(z.number());
  const save = base.input(z.number()).handler(async ({ input, queries, signal }) => {
    expect(signal.aborted).toBe(false);
    return input + (await queries.read());
  });
  const other = base.input(z.string()).handler(({ input }) => input.length);
  expect(save.args.safeParse(2).success).toBe(true);
  expect(save.args.safeParse("2").success).toBe(false);
  expect(other.args.safeParse("2").success).toBe(true);
  const query = vi.fn(() => Promise.resolve(4));
  const run = actionRunner(defineServer({ ...functions, save }), {
    query,
    mutate: vi.fn(),
  });
  expect(await run({ name: "save", args: 2 }, identity)).toBe(6);
  expect(query).toHaveBeenCalledWith({ name: "read", args: undefined });
});

it("uses undefined input and infers returns for mutations and async actions without schemas", async () => {
  const functions = {
    save: tk.mutation.handler(({ input }) => {
      expect(input).toBeUndefined();
      return { saved: true };
    }),
    read: tk.query.handler(({ input }) => {
      expect(input).toBeUndefined();
      return [1, 2];
    }),
  };
  const perform = tk.action.functions(functions).handler(async ({ input, queries, mutations }) => {
    expect(input).toBeUndefined();
    return { rows: await queries.read(), saved: await mutations.save() };
  });
  const app = defineServer({ ...functions, perform });
  expect(functions.read).not.toHaveProperty("result");
  expect(functions.save).not.toHaveProperty("result");
  expect(perform).not.toHaveProperty("result");
  const execute = createExecution(app, persistence);
  const query = vi.fn((input) => Promise.resolve(execute.query(input, identity).value));
  const mutate = vi.fn((input) => Promise.resolve(execute.mutate(input, identity).value));
  const run = actionRunner(app, { query, mutate });
  expect(await run({ name: "perform" }, identity)).toEqual({
    rows: [1, 2],
    saved: { saved: true },
  });
  expect(query).toHaveBeenCalledWith({ name: "read", args: undefined });
  expect(mutate).toHaveBeenCalledWith({
    name: "save",
    args: undefined,
    requestId: expect.any(String),
  });
  await expect(run({ name: "perform", args: {} }, identity)).rejects.toThrow(
    "Invalid function arguments",
  );
});

it("validates optional output schemas for synchronous and async actions", async () => {
  const app = defineServer({
    valid: tk.action.output(z.number().min(10)).handler(() => 10),
    invalid: tk.action.output(z.number().min(10)).handler(() => 1),
    invalidAsync: tk.action.output(z.number().min(10)).handler(() => Promise.resolve(1)),
    transformed: tk.action.output(z.string().transform(Number)).handler(() => Promise.resolve("4")),
  });
  const run = actionRunner(app, { query: vi.fn(), mutate: vi.fn() });
  expect(await run({ name: "valid" }, identity)).toBe(10);
  expect(await run({ name: "transformed" }, identity)).toBe(4);
  for (const name of ["invalid", "invalidAsync"]) {
    await expect(run({ name }, identity)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Invalid function result",
    });
  }
});
