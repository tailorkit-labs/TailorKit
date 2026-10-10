import { expect, it, vi } from "vite-plus/test";
import { tk } from "@tailorkit/app/server";
import { defineServer } from "@tailorkit/app/server";
import { resolveFunction } from "./functions";
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
import { createApi } from "@tailorkit/app/client";

it("dispatches nested functions and preserves their names, identity, execution and typed action calls", async () => {
  const todos = {
    read: tk.query.handler(() => "rows"),
    save: tk.mutation.handler(() => "saved"),
  };
  const app = defineServer({
    todos,
    tasks: {
      run: tk.action.functions({ todos }).handler(async ({ queries, mutations }) => ({
        rows: await queries.todos.read(),
        saved: await mutations.todos.save(),
      })),
    },
  });
  expect(resolveFunction(app.functions, "todos.read")).toBe(todos.read);
  expect(resolveFunction(app.functions, "tasks.run")).toBe(app.functions.tasks.run);
  expect(resolveFunction(app.functions, "todos.constructor")).toBeUndefined();
  const api = createApi<typeof app.functions>();
  expect(api.todos.read.name).toBe("todos.read");
  expect(api.tasks.run.name).toBe("tasks.run");
  const identity = {
    subjectId: "u",
    projectId: "p",
    scope: { name: "org", value: { id: "tenant" } },
    toolUrl: "https://host.test/api/tailorkit/tools/execute",
    appId: "a",
    installationId: "i",
    deploymentId: "d",
    expiresAt: Date.now() + 60_000,
  };
  const execution = createExecution(app, {
    execute: () => ({ rows: [], columns: [], changes: 0 }),
    transaction: (run) => run(),
  });
  expect(
    execution.query(invocationSchema.parse({ name: api.todos.read.name }), identity).value,
  ).toBe("rows");
  const query = vi.fn(async () => "rows");
  const mutate = vi.fn(async () => "saved");
  const run = actionRunner(app, { query, mutate });
  await expect(run({ name: api.tasks.run.name }, identity)).resolves.toEqual({
    rows: "rows",
    saved: "saved",
  });
  expect(query).toHaveBeenCalledWith({ name: "todos.read", args: undefined });
  expect(mutate).toHaveBeenCalledWith({
    name: "todos.save",
    args: undefined,
    requestId: expect.any(String),
  });
});

it("validates names inside nested groups", () => {
  expect(() => defineServer({ todos: { "invalid.name": tk.query.handler(() => null) } })).toThrow(
    "Invalid function name",
  );
  for (const name of [
    "todos..read",
    ".read",
    "todos.__proto__",
    "todos.read.",
    "_other.instances.page",
    "_tailorkitExtra.instances.page",
    "todos._tailorkit.read",
    "_tailorkit.instances._page",
    "_tailorkit..page",
  ])
    expect(invocationSchema.safeParse({ name }).success).toBe(false);
});

it("allows the reserved internal invocation namespace without allowing apps to register it", () => {
  for (const name of ["_tailorkit.instances.resolve", "_tailorkit.future.resolve"])
    expect(invocationSchema.parse({ name })).toEqual({ name });
  expect(() => defineServer({ _tailorkit: {} })).toThrow("Invalid function name");
});
