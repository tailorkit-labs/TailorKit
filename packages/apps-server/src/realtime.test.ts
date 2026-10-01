import { expect, it, vi } from "vite-plus/test";
import { createRealtime, type Execution } from "./realtime";
import type { Identity } from "./functions";

const identity: Identity = {
  userId: "one",
  projectId: "project",
  appId: "app",
  installationId: "install",
  deploymentId: "v1",
  expiresAt: Date.now() + 60_000,
};
const input = { name: "list", args: {} };
const mutation = { name: "change", args: {}, requestId: "00000000-0000-4000-8000-000000000001" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("registers the initial snapshot before a concurrent mutation and replaces dependencies", async () => {
  const first = deferred<{ value: number; tables: string[] }>();
  const query = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ value: 1, tables: ["other"] })
    .mockResolvedValueOnce({ value: 2, tables: ["other"] });
  let tables = ["todos"];
  const realtime = createRealtime({
    query,
    mutate: async () => ({ value: null, tables, committed: true }),
  });
  const next = vi.fn();
  const stop = realtime.subscribe(input, identity, next, vi.fn());
  const pending = realtime.mutate(mutation, identity);
  first.resolve({ value: 0, tables: ["todos"] });
  await pending;
  expect(next.mock.calls).toEqual([[0], [1]]);
  await realtime.mutate(mutation, identity);
  expect(query).toHaveBeenCalledTimes(2);
  tables = ["other"];
  await realtime.mutate(mutation, identity);
  expect(next.mock.calls).toEqual([[0], [1], [2]]);
  stop();
  await realtime.mutate(mutation, identity);
  expect(query).toHaveBeenCalledTimes(3);
});
it("discards a pending initial snapshot after unsubscribe", async () => {
  const first = deferred<{ value: number; tables: string[] }>();
  const realtime = createRealtime({
    query: () => first.promise,
    mutate: async () => ({ value: null, tables: ["todos"], committed: true }),
  });
  const next = vi.fn();
  const stop = realtime.subscribe(input, identity, next, vi.fn());
  await Promise.resolve();
  stop();
  first.resolve({ value: 0, tables: ["todos"] });
  await realtime.query(input, identity);
  expect(next).not.toHaveBeenCalled();
});
it("does not invalidate on failed, replayed or unchanged mutations", async () => {
  const query = vi.fn().mockResolvedValue({ value: [], tables: ["todos"] });
  const mutate = vi
    .fn()
    .mockRejectedValueOnce(new Error("rollback"))
    .mockResolvedValueOnce({ value: null, tables: ["todos"], committed: false })
    .mockResolvedValueOnce({ value: null, tables: [], committed: true });
  const realtime = createRealtime({ query, mutate });
  realtime.subscribe(input, identity, vi.fn(), vi.fn());
  await realtime.query(input, identity);
  await expect(realtime.mutate(mutation, identity)).rejects.toThrow("rollback");
  await realtime.mutate(mutation, identity);
  await realtime.mutate(mutation, identity);
  expect(query).toHaveBeenCalledTimes(2);
});
it("reruns each query as its own user and isolates a failed subscription", async () => {
  let changed = false;
  const execution: Execution = {
    query: async (_input, user) => {
      if (changed && user.userId === "one") throw new Error("no longer authorized");
      return { value: user.userId, tables: ["todos"] };
    },
    mutate: async () => {
      changed = true;
      return { value: null, tables: ["todos"], committed: true };
    },
  };
  const realtime = createRealtime(execution);
  const fail = vi.fn();
  const second = vi.fn();
  realtime.subscribe(input, identity, vi.fn(), fail);
  realtime.subscribe(input, { ...identity, userId: "two" }, second, vi.fn());
  await realtime.mutate(mutation, identity);
  expect(fail).toHaveBeenCalledTimes(1);
  expect(second.mock.calls).toEqual([["two"], ["two"]]);
  await realtime.mutate(mutation, identity);
  expect(fail).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(3);
});
