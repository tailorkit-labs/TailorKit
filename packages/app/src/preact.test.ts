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

// The Nanostores Preact adapter batches hook updates with a zero-delay timer.
async function actWithStoreUpdates(callback: () => unknown) {
  await act(async () => {
    await callback();
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
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
  await actWithStoreUpdates(() => render(null, root));
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
  await actWithStoreUpdates(() => render(tree(false), root));
  expect(first.isLoading).toBe(true);
  expect(client.subscribe).toHaveBeenCalledOnce();
  await actWithStoreUpdates(() => subscription(0).next([1, 2]));
  expect(first.data).toEqual([1, 2]);
  expect(second.data).toEqual([1, 2]);
  await actWithStoreUpdates(() => render(tree(true, false), root));
  expect(client.subscribe).toHaveBeenCalledOnce();
  expect(subscription(0).stop).not.toHaveBeenCalled();
  await actWithStoreUpdates(() =>
    subscription(0).error(new AppError("UNAVAILABLE", "Connection lost")),
  );
  expect(first.error?.message).toBe("Connection lost");
  expect(first.data).toEqual([1, 2]);
  await actWithStoreUpdates(() => subscription(0).next([3]));
  expect(first.error).toBeNull();
  expect(first.data).toEqual([3]);
  await actWithStoreUpdates(() => render(null, root));
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
  await actWithStoreUpdates(() => render(tree("one"), root));
  await actWithStoreUpdates(() => subscription(0).next("first"));
  expect(state.data).toBe("first");
  await actWithStoreUpdates(() => render(tree("two"), root));
  expect(state.data).toBeUndefined();
  expect(state.isLoading).toBe(true);
  expect(subscription(0).stop).toHaveBeenCalledOnce();
  await actWithStoreUpdates(() => subscription(0).next("late"));
  expect(state.data).toBeUndefined();
  await actWithStoreUpdates(() => subscription(1).next("second"));
  expect(state.data).toBe("second");
  await actWithStoreUpdates(() => render(tree("two", false), root));
  expect(state.isLoading).toBe(false);
  expect(subscription(1).stop).toHaveBeenCalledOnce();
  await actWithStoreUpdates(() => render(null, root));
  expect(client.close).not.toHaveBeenCalled();
});

it("preserves null inputs and supports omitted inputs for no-input functions", async () => {
  function View() {
    useQuery(reference<"query", null, string>("nullable", "query"), null);
    useQuery(reference<"query", undefined, string>("empty", "query"));
    return null;
  }
  await actWithStoreUpdates(() => render(h(ClientProvider, { client }, h(View, {})), root));
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
  await actWithStoreUpdates(() =>
    render(h(ClientProvider, { client, onError }, h(View, {})), root),
  );
  vi.mocked(client.mutate).mockRejectedValueOnce(new AppError("CONFLICT", "Try another value"));
  await actWithStoreUpdates(async () => {
    state.mutate({ value: 1 });
    await Promise.resolve();
  });
  expect(state.isError).toBe(true);
  expect(state.error?.message).toBe("Try another value");
  expect(onError).toHaveBeenCalledOnce();
  vi.mocked(client.mutate).mockResolvedValueOnce(2);
  await actWithStoreUpdates(async () => {
    expect(await state.mutateAsync({ value: 2 })).toBe(2);
  });
  expect(state.data).toBe(2);
  expect(state.error).toBeNull();
  expect(onSuccess).toHaveBeenCalledWith(2, { value: 2 });
  await actWithStoreUpdates(() => state.reset());
  expect(state.status).toBe("idle");
});

it("keeps the latest call result when calls overlap and ignores completion after reset", async () => {
  const ref = reference<"mutation", number, number>("write", "mutation");
  let state!: MutationResult<number, number>;
  function View() {
    state = useMutation(ref);
    return null;
  }
  await actWithStoreUpdates(() => render(h(ClientProvider, { client }, h(View, {})), root));
  const older = Promise.withResolvers<number>();
  const newer = Promise.withResolvers<number>();
  vi.mocked(client.mutate).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  await actWithStoreUpdates(() => {
    state.mutate(1);
    state.mutate(2);
  });
  expect(state.isPending).toBe(true);
  await actWithStoreUpdates(async () => {
    newer.resolve(2);
    await newer.promise;
  });
  expect(state.data).toBe(2);
  await actWithStoreUpdates(async () => {
    older.resolve(1);
    await older.promise;
  });
  expect(state.data).toBe(2);
  const pending = Promise.withResolvers<number>();
  vi.mocked(client.mutate).mockReturnValueOnce(pending.promise);
  await actWithStoreUpdates(() => state.mutate(3));
  await actWithStoreUpdates(() => state.reset());
  await actWithStoreUpdates(async () => {
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
  await actWithStoreUpdates(() => render(h(ClientProvider, { client }, h(View, {})), root));
  expect(client.action).not.toHaveBeenCalled();
  const pending = Promise.withResolvers<string>();
  vi.mocked(client.action).mockReturnValueOnce(pending.promise);
  await actWithStoreUpdates(() => state.execute());
  expect(client.action).toHaveBeenCalledWith({ name: "import" }, undefined);
  await actWithStoreUpdates(() => render(null, root));
  await actWithStoreUpdates(async () => {
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
  await actWithStoreUpdates(() =>
    render(h(ClientProvider, { client }, [h(Profile, {}), h(Todos, {})]), root),
  );
  const before = {
    profile: renders.profile.mock.calls.length,
    todos: renders.todos.mock.calls.length,
  };
  await actWithStoreUpdates(() => subscription(0).next("Alice"));
  expect(renders.profile.mock.calls.length).toBeGreaterThan(before.profile);
  expect(renders.todos).toHaveBeenCalledTimes(before.todos);
  const profileRenders = renders.profile.mock.calls.length;
  await actWithStoreUpdates(() => subscription(1).next(["Todo"]));
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
  await actWithStoreUpdates(() => render(tree(true), root));
  expect(client.subscribe).toHaveBeenCalledOnce();
  await actWithStoreUpdates(() => subscription(0).next("Alice"));
  expect(first.data).toBe("Alice");
  expect(second.data).toBe("Alice");
  await actWithStoreUpdates(() => render(tree(false), root));
  expect(subscription(0).stop).not.toHaveBeenCalled();
  await actWithStoreUpdates(() => subscription(0).next("Bob"));
  expect(second.data).toBe("Bob");
  await actWithStoreUpdates(() => render(null, root));
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
  await actWithStoreUpdates(() => render(tree(true), root));
  await actWithStoreUpdates(() => subscription(0).next("Alice"));
  await actWithStoreUpdates(() => render(tree(false), root));
  await actWithStoreUpdates(() => render(tree(true), root));
  expect(client.subscribe).toHaveBeenCalledTimes(2);
  expect(state.isPending).toBe(true);
  await actWithStoreUpdates(() => subscription(0).next("Old result"));
  await actWithStoreUpdates(() => subscription(0).error(new AppError("UNAVAILABLE", "Old error")));
  expect(state.data).toBeUndefined();
  expect(state.error).toBeNull();
  await actWithStoreUpdates(() => subscription(1).next("Fresh result"));
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
  await actWithStoreUpdates(() => render(h(ClientProvider, { client }, h(View, {})), root));
  expect(state.data).toBe("ready");
  await actWithStoreUpdates(() => render(null, root));
  expect(stop).toHaveBeenCalledOnce();
});

it("switches query stores when the provider client changes and ignores the previous client", async () => {
  const replacement: Client = {
    ...client,
    subscribe: vi.fn(vi.mocked(client.subscribe).getMockImplementation()),
    close: vi.fn(),
  };
  const onError = vi.fn();
  let state!: QueryResult<string>;
  function View() {
    state = useQuery(reference<"query", undefined, string>("profile", "query"));
    return null;
  }
  const tree = (currentClient: Client) =>
    h(ClientProvider, { client: currentClient, onError }, h(View, {}));
  await actWithStoreUpdates(() => render(tree(client), root));
  await actWithStoreUpdates(() => subscription(0).next("old client"));
  expect(state.data).toBe("old client");

  await actWithStoreUpdates(() => render(tree(replacement), root));
  expect(subscription(0).stop).toHaveBeenCalledOnce();
  expect(replacement.subscribe).toHaveBeenCalledOnce();
  expect(state.isPending).toBe(true);
  expect(state.data).toBeUndefined();
  await actWithStoreUpdates(() => {
    subscription(0).next("late data");
    subscription(0).error(new AppError("UNAVAILABLE", "late error"));
  });
  expect(state.data).toBeUndefined();
  expect(state.error).toBeNull();
  expect(onError).not.toHaveBeenCalled();

  await actWithStoreUpdates(() => subscription(1).next("new client"));
  expect(state.data).toBe("new client");
  await actWithStoreUpdates(() => render(null, root));
  expect(subscription(1).stop).toHaveBeenCalledOnce();
  expect(client.close).not.toHaveBeenCalled();
  expect(replacement.close).not.toHaveBeenCalled();
});

it("resets call state when the reference changes and ignores the previous call's result", async () => {
  let state!: MutationResult<number, number>;
  const onSuccess = vi.fn();
  function View({ name }: { name: string }) {
    state = useMutation(reference<"mutation", number, number>(name, "mutation"), { onSuccess });
    return null;
  }
  const tree = (name: string) => h(ClientProvider, { client }, h(View, { name }));
  const pending = Promise.withResolvers<number>();
  vi.mocked(client.mutate).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(2);
  await actWithStoreUpdates(() => render(tree("first"), root));
  await actWithStoreUpdates(() => state.mutate(1));
  expect(state.isPending).toBe(true);

  await actWithStoreUpdates(() => render(tree("second"), root));
  expect(state.status).toBe("idle");
  await actWithStoreUpdates(async () => {
    pending.resolve(1);
    await pending.promise;
  });
  expect(state.status).toBe("idle");
  expect(onSuccess).not.toHaveBeenCalled();

  await actWithStoreUpdates(async () => {
    expect(await state.mutateAsync(2)).toBe(2);
  });
  expect(state.data).toBe(2);
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith(2, 2);
});
