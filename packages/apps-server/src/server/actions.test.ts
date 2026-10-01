import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { action, defineApp, query, mutation } from "../index";
import type { ActionContext } from "./functions";
import { createActionExecution } from "./actions";

const identity = {
  userId: "user",
  projectId: "project",
  appId: "app",
  installationId: "install",
  deploymentId: "v1",
  expiresAt: Date.now() + 60_000,
};
const functions = {
  read: query({ args: z.object({}), handler: () => 4 }),
  write: mutation({ args: z.object({ value: z.number() }), handler: ({ args }) => args.value }),
};

it("awaits actions and exposes scoped calls instead of a database handle", async () => {
  const queryCall = vi.fn().mockResolvedValue(4);
  const mutateCall = vi.fn().mockResolvedValue(6);
  const app = defineApp({
    ...functions,
    plus: action({
      functions,
      args: z.object({ delta: z.number() }),
      result: z.number(),
      async handler(context) {
        expect("db" in context).toBe(false);
        expect("runQuery" in context).toBe(false);
        expect(Object.keys(context.queries)).toEqual(["read"]);
        expect(Object.keys(context.mutations)).toEqual(["write"]);
        expect(Object.isFrozen(context.mutations)).toBe(true);
        expect(context.identity).toEqual(identity);
        const prior = await context.queries.read({});
        return context.mutations.write({ value: prior + context.args.delta });
      },
    }),
  });
  const run = createActionExecution(app, { query: queryCall, mutate: mutateCall });
  expect(await run({ name: "plus", args: { delta: 2 } }, identity)).toBe(6);
  expect(queryCall).toHaveBeenCalledWith({ name: "read", args: {} });
  expect(mutateCall).toHaveBeenCalledWith({
    name: "write",
    args: { value: 6 },
    requestId: expect.any(String),
  });
});
it("validates kind, arguments, expiry and output", async () => {
  const calls = { query: vi.fn(), mutate: vi.fn() };
  const app = defineApp({
    ...functions,
    invalid: action({
      args: z.object({ value: z.string() }),
      result: z.string(),
      handler: () => 1 as unknown as string,
    }),
    read: query({ args: z.object({}), handler: () => 1 }),
  });
  const run = createActionExecution(app, calls);
  await expect(run({ name: "read", args: {} }, identity)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(run({ name: "invalid", args: {} }, identity)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(
    run({ name: "invalid", args: { value: "x" } }, { ...identity, expiresAt: 0 }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(run({ name: "invalid", args: { value: "x" } }, identity)).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });
  expect(calls.query).not.toHaveBeenCalled();
});
it("does not retry actions or roll back earlier independent mutations after failure", async () => {
  const mutate = vi.fn().mockResolvedValue(1);
  const sideEffect = vi.fn();
  const app = defineApp({
    ...functions,
    fail: action({
      functions,
      args: z.object({}),
      async handler(ctx) {
        sideEffect();
        await ctx.mutations.write(
          { value: 1 },
          { requestId: "00000000-0000-4000-8000-000000000001" },
        );
        throw new Error("external failure");
      },
    }),
  });
  await expect(
    createActionExecution(app, { query: vi.fn(), mutate })({ name: "fail", args: {} }, identity),
  ).rejects.toThrow("external failure");
  expect(sideEffect).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledWith({
    name: "write",
    args: { value: 1 },
    requestId: "00000000-0000-4000-8000-000000000001",
  });
  expect(mutate).toHaveBeenCalledTimes(1);
});
it("revokes callbacks after completion and cancellation", async () => {
  let context!: ActionContext<typeof functions>;
  const mutate = vi.fn();
  const app = defineApp({
    ...functions,
    capture: action({
      functions,
      args: z.object({}),
      handler: (ctx) => {
        context = ctx;
        return null;
      },
    }),
  });
  await createActionExecution(app, { query: vi.fn(), mutate })(
    { name: "capture", args: {} },
    identity,
  );
  expect(() => context.mutations.write({ value: 1 })).toThrow("Action has ended");
  const controller = new AbortController();
  controller.abort();
  await expect(
    createActionExecution(app, { query: vi.fn(), mutate })(
      { name: "capture", args: {} },
      identity,
      controller.signal,
    ),
  ).rejects.toThrow("Action has ended");
  expect(mutate).not.toHaveBeenCalled();
});

it("revokes a running action's callbacks before its asynchronous work finishes", async () => {
  let context!: ActionContext<typeof functions>;
  let finish!: () => void;
  const external = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const mutate = vi.fn();
  const app = defineApp({
    ...functions,
    wait: action({
      functions,
      args: z.object({}),
      async handler(ctx) {
        context = ctx;
        await external;
        return null;
      },
    }),
  });
  const controller = new AbortController();
  const running = createActionExecution(app, { query: vi.fn(), mutate })(
    { name: "wait", args: {} },
    identity,
    controller.signal,
  );
  controller.abort();
  expect(() => context.mutations.write({ value: 1 })).toThrow("Action has ended");
  finish();
  await expect(running).rejects.toThrow("Action has ended");
  expect(mutate).not.toHaveBeenCalled();
});

it("rejects action call collections that are not registered under the same names", async () => {
  const calls = { query: vi.fn(), mutate: vi.fn() };
  const app = defineApp({
    write: functions.write,
    bad: action({
      functions: { missing: functions.write },
      args: z.object({}),
      handler: (ctx) => ctx.mutations.missing({ value: 1 }),
    }),
  });
  await expect(
    createActionExecution(app, calls)({ name: "bad", args: {} }, identity),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(calls.mutate).not.toHaveBeenCalled();
});
