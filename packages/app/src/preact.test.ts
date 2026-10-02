/* oxlint-disable react/globals -- Test components expose hook snapshots to the assertions. */
import { Window } from "happy-dom";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ClientProvider, useAction, useMutation, useQuery } from "./preact";
import type { ActionResult, MutationResult, QueryResult } from "./preact";
import type { Client } from "./client/connection";
import { reference } from "./client/reference";
import { AppError } from "./errors";

const transport = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("./client/connection", () => ({ createClient: transport.createClient }));

let window: Window;
let root: HTMLDivElement;
let client: Client;
const subscriptions: {
  name: string;
  input: unknown;
  next: (value: unknown) => void;
  error: (error: AppError) => void;
  stop: ReturnType<typeof vi.fn>;
}[] = [];

function subscription(index: number) {
  const value = subscriptions[index];
  if (!value) {
    throw new Error("Missing subscription");
  }
  return value;
}

beforeEach(() => {
  window = new Window();
  vi.stubGlobal("document", window.document);
  root = document.createElement("div");
  subscriptions.length = 0;
  client = {
    query: vi.fn(),
    mutate: vi.fn(),
    action: vi.fn(),
    close: vi.fn(),
    subscribe: vi.fn((ref, input, next, options) => {
      const stop = vi.fn();
      subscriptions.push({
        name: ref.name,
        input,
        next,
        error: options?.onError ?? (() => {}),
        stop,
      });
      return stop;
    }),
  };
  transport.createClient.mockReset().mockReturnValue(client);
});
afterEach(async () => {
  await act(() => render(null, root));
  await window.happyDOM.close();
  vi.unstubAllGlobals();
});

it("shares live queries, preserves subscriptions across equivalent inputs, and clears recovered errors", async () => {
  const ref = reference<"query", { a: number; b: number }, number[]>("list", "query");
  let first!: QueryResult<number[]>;
  let second!: QueryResult<number[]>;
  function First({ reverse }: { reverse: boolean }) {
    first = useQuery(ref, reverse ? { b: 2, a: 1 } : { a: 1, b: 2 });
    return null;
  }
  function Second() {
    second = useQuery(ref, { a: 1, b: 2 });
    return null;
  }
  const tree = (reverse: boolean, showSecond = true) =>
    h(ClientProvider, {}, [h(First, { reverse }), showSecond && h(Second, {})]);
  await act(() => render(tree(false), root));
  expect(first.isLoading).toBe(true);
  expect(client.subscribe).toHaveBeenCalledOnce();
  await act(() => subscription(0).next([1, 2]));
  expect(first.data).toEqual([1, 2]);
  expect(second.data).toEqual([1, 2]);
  await act(() => render(tree(true, false), root));
  expect(client.subscribe).toHaveBeenCalledOnce();
  expect(subscription(0).stop).not.toHaveBeenCalled();
  await act(() => subscription(0).error(new AppError("UNAVAILABLE", "Connection lost")));
  expect(first.error?.message).toBe("Connection lost");
  expect(first.data).toEqual([1, 2]);
  await act(() => subscription(0).next([3]));
  expect(first.error).toBeNull();
  expect(first.data).toEqual([3]);
  await act(() => render(null, root));
  expect(subscription(0).stop).toHaveBeenCalledOnce();
  expect(client.close).toHaveBeenCalledOnce();
  expect(transport.createClient).toHaveBeenCalledOnce();
});

it("resets stale query data when inputs change, ignores old snapshots, and respects enabled", async () => {
  const ref = reference<"query", { id: string }, string>("get", "query");
  let state!: QueryResult<string>;
  function View({ id, enabled }: { id: string; enabled: boolean }) {
    state = useQuery(ref, { id }, { enabled });
    return null;
  }
  const tree = (id: string, enabled = true) =>
    h(ClientProvider, { client }, h(View, { id, enabled }));
  await act(() => render(tree("one"), root));
  await act(() => subscription(0).next("first"));
  expect(state.data).toBe("first");
  await act(() => render(tree("two"), root));
  expect(state.data).toBeUndefined();
  expect(state.isLoading).toBe(true);
  expect(subscription(0).stop).toHaveBeenCalledOnce();
  await act(() => subscription(0).next("late"));
  expect(state.data).toBeUndefined();
  await act(() => subscription(1).next("second"));
  expect(state.data).toBe("second");
  await act(() => render(tree("two", false), root));
  expect(state.isLoading).toBe(false);
  expect(subscription(1).stop).toHaveBeenCalledOnce();
  await act(() => render(null, root));
  expect(client.close).not.toHaveBeenCalled();
});

it("preserves null inputs and supports omitted inputs for no-input functions", async () => {
  function View() {
    useQuery(reference<"query", null, string>("nullable", "query"), null);
    useQuery(reference<"query", undefined, string>("empty", "query"));
    return null;
  }
  await act(() => render(h(ClientProvider, { client }, h(View, {})), root));
  expect(subscriptions.map(({ input }) => input)).toEqual([null, undefined]);
});

it("captures mutation failures without unhandled rejections, reports errors, and supports reset", async () => {
  const ref = reference<"mutation", { value: number }, number>("write", "mutation");
  let state!: MutationResult<{ value: number }, number>;
  const onError = vi.fn();
  const onSuccess = vi.fn();
  function View() {
    state = useMutation(ref, { onSuccess });
    return null;
  }
  await act(() => render(h(ClientProvider, { client, onError }, h(View, {})), root));
  vi.mocked(client.mutate).mockRejectedValueOnce(new AppError("CONFLICT", "Try another value"));
  await act(async () => {
    state.mutate({ value: 1 });
    await Promise.resolve();
  });
  expect(state.isError).toBe(true);
  expect(state.error?.message).toBe("Try another value");
  expect(onError).toHaveBeenCalledOnce();
  vi.mocked(client.mutate).mockResolvedValueOnce(2);
  await act(async () => {
    expect(await state.mutateAsync({ value: 2 })).toBe(2);
  });
  expect(state.data).toBe(2);
  expect(state.error).toBeNull();
  expect(onSuccess).toHaveBeenCalledWith(2, { value: 2 });
  await act(() => state.reset());
  expect(state.status).toBe("idle");
});

it("keeps the latest call result when calls overlap and ignores completion after reset", async () => {
  const ref = reference<"mutation", number, number>("write", "mutation");
  let state!: MutationResult<number, number>;
  function View() {
    state = useMutation(ref);
    return null;
  }
  await act(() => render(h(ClientProvider, { client }, h(View, {})), root));
  const older = Promise.withResolvers<number>();
  const newer = Promise.withResolvers<number>();
  vi.mocked(client.mutate).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  await act(() => {
    state.mutate(1);
    state.mutate(2);
  });
  expect(state.isPending).toBe(true);
  await act(async () => {
    newer.resolve(2);
    await newer.promise;
  });
  expect(state.data).toBe(2);
  await act(async () => {
    older.resolve(1);
    await older.promise;
  });
  expect(state.data).toBe(2);
  const pending = Promise.withResolvers<number>();
  vi.mocked(client.mutate).mockReturnValueOnce(pending.promise);
  await act(() => state.mutate(3));
  await act(() => state.reset());
  await act(async () => {
    pending.resolve(3);
    await pending.promise;
  });
  expect(state.status).toBe("idle");
});

it("runs actions explicitly and does not call completion callbacks after unmount", async () => {
  let state!: ActionResult<undefined, string>;
  const onSuccess = vi.fn();
  function View() {
    state = useAction(reference("import", "action"), { onSuccess });
    return null;
  }
  await act(() => render(h(ClientProvider, { client }, h(View, {})), root));
  expect(client.action).not.toHaveBeenCalled();
  const pending = Promise.withResolvers<string>();
  vi.mocked(client.action).mockReturnValueOnce(pending.promise);
  await act(() => state.execute());
  expect(client.action).toHaveBeenCalledWith({ name: "import" }, undefined);
  // Preact 11 defers passive cleanup. Calls must be cancelled at unmount,
  // before those effects flush or a pending action can complete.
  render(null, root);
  await act(async () => {
    pending.resolve("done");
    await pending.promise;
  });
  expect(onSuccess).not.toHaveBeenCalled();
});

it("keeps unrelated query updates from rerendering other observers", async () => {
  const renders = { profile: vi.fn(), todos: vi.fn() };
  function Profile() {
    useQuery(reference<"query", undefined, string>("profile", "query"));
    renders.profile();
    return null;
  }
  function Todos() {
    useQuery(reference<"query", undefined, string[]>("todos", "query"));
    renders.todos();
    return null;
  }
  await act(() => render(h(ClientProvider, { client }, [h(Profile, {}), h(Todos, {})]), root));
  const before = {
    profile: renders.profile.mock.calls.length,
    todos: renders.todos.mock.calls.length,
  };
  await act(() => subscription(0).next("Alice"));
  expect(renders.profile.mock.calls.length).toBeGreaterThan(before.profile);
  expect(renders.todos).toHaveBeenCalledTimes(before.todos);
  const profileRenders = renders.profile.mock.calls.length;
  await act(() => subscription(1).next(["Todo"]));
  expect(renders.todos.mock.calls.length).toBeGreaterThan(before.todos);
  expect(renders.profile).toHaveBeenCalledTimes(profileRenders);
});

it("shares nested equivalent inputs and keeps the subscription until its last observer leaves", async () => {
  const ref = reference<"query", { filter: { a: number; b: number } }, string>("profile", "query");
  let first!: QueryResult<string>;
  let second!: QueryResult<string>;
  function First() {
    first = useQuery(ref, { filter: { a: 1, b: 2 } });
    return null;
  }
  function Second() {
    second = useQuery(ref, { filter: { b: 2, a: 1 } });
    return null;
  }
  const tree = (showFirst: boolean) =>
    h(ClientProvider, { client }, [showFirst && h(First, {}), h(Second, {})]);
  await act(() => render(tree(true), root));
  expect(client.subscribe).toHaveBeenCalledOnce();
  await act(() => subscription(0).next("Alice"));
  expect(first.data).toBe("Alice");
  expect(second.data).toBe("Alice");
  await act(() => render(tree(false), root));
  expect(subscription(0).stop).not.toHaveBeenCalled();
  await act(() => subscription(0).next("Bob"));
  expect(second.data).toBe("Bob");
  await act(() => render(null, root));
  expect(subscription(0).stop).toHaveBeenCalledOnce();
});

it("ignores snapshots from a cancelled subscription when the same query is enabled again", async () => {
  let state!: QueryResult<string>;
  function View({ enabled }: { enabled: boolean }) {
    state = useQuery(reference<"query", undefined, string>("profile", "query"), undefined, {
      enabled,
    });
    return null;
  }
  const tree = (enabled: boolean) => h(ClientProvider, { client }, h(View, { enabled }));
  await act(() => render(tree(true), root));
  await act(() => subscription(0).next("Alice"));
  await act(() => render(tree(false), root));
  await act(() => render(tree(true), root));
  expect(client.subscribe).toHaveBeenCalledTimes(2);
  expect(state.isPending).toBe(true);
  await act(() => subscription(0).next("Old result"));
  await act(() => subscription(0).error(new AppError("UNAVAILABLE", "Old error")));
  expect(state.data).toBeUndefined();
  expect(state.error).toBeNull();
  await act(() => subscription(1).next("Fresh result"));
  expect(state.data).toBe("Fresh result");
});

it("captures snapshots delivered synchronously while opening a subscription", async () => {
  const stop = vi.fn();
  vi.mocked(client.subscribe).mockImplementation((_ref, _input, next) => {
    next("ready" as never);
    return stop;
  });
  let state!: QueryResult<string>;
  function View() {
    state = useQuery(reference<"query", undefined, string>("profile", "query"));
    return null;
  }
  await act(() => render(h(ClientProvider, { client }, h(View, {})), root));
  expect(state.data).toBe("ready");
  await act(() => render(null, root));
  expect(stop).toHaveBeenCalledOnce();
});
