import { allTasks } from "nanostores";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createFetchCache, serializeCacheKey } from "./cache";

afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("fetch cache", () => {
  it("shares in-flight requests and snapshots across equivalent keys", async () => {
    const cache = createFetchCache({ gcTime: Infinity });
    const response = deferred<string[]>();
    const fetcher = vi.fn(() => response.promise);
    const first = cache.getStore(["apps", { b: 2, a: 1 }], fetcher);
    const second = cache.getStore(["apps", { a: 1, b: 2 }], fetcher);
    const listener = vi.fn();
    const stop = second.subscribe(listener);
    const pending = first.fetch();
    expect(second.fetch()).toBe(pending);
    expect(second.getSnapshot()).toBe(first.getSnapshot());
    response.resolve(["app"]);
    await pending;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(second.getSnapshot()).toMatchObject({
      data: ["app"],
      status: "ready",
      isFetching: false,
    });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    stop();
  });

  it("respects defaults, overrides, zero and infinite stale times", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fetcher = vi.fn().mockResolvedValue("data");
    const cache = createFetchCache({ staleTime: 100, gcTime: Infinity });
    const store = cache.getStore(["apps"], fetcher);
    await store.fetch();
    await store.fetch();
    expect(fetcher).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    await store.fetch({ staleTime: 500 });
    expect(fetcher).toHaveBeenCalledOnce();
    await store.fetch();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await store.fetch({ staleTime: 0 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1_000_000);
    await store.fetch({ staleTime: Infinity });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await store.fetch({ force: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("keeps successful data available while revalidating", async () => {
    const response = deferred<string>();
    const fetcher = vi.fn().mockResolvedValueOnce("old").mockReturnValueOnce(response.promise);
    const store = createFetchCache({ gcTime: Infinity }).getStore(["apps"], fetcher);
    await store.fetch();
    const pending = store.fetch({ force: true });
    expect(store.getSnapshot()).toMatchObject({ data: "old", status: "ready", isFetching: true });
    response.resolve("new");
    await pending;
    expect(store.getSnapshot()).toMatchObject({ data: "new", status: "ready", isFetching: false });
  });

  it("evicts unused data after gcTime and retains actively observed data", async () => {
    vi.useFakeTimers();
    const cache = createFetchCache({ gcTime: 100, staleTime: Infinity });
    const fetcher = vi.fn().mockResolvedValue("data");
    const store = cache.getStore(["apps"], fetcher);
    const stop = store.subscribe(vi.fn());
    await store.fetch();
    vi.advanceTimersByTime(200);
    expect(store.getSnapshot().data).toBe("data");
    stop();
    vi.advanceTimersByTime(99);
    expect(store.getSnapshot().data).toBe("data");
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().status).toBe("idle");
    await store.fetch();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("cancels only when the last instance subscriber leaves and ignores late results", async () => {
    const cache = createFetchCache({ gcTime: Infinity });
    const response = deferred<string>();
    let signal!: AbortSignal;
    const store = cache.getStore(
      ["instances"],
      (input) => {
        signal = input;
        return response.promise;
      },
      { abortOnUnsubscribe: true },
    );
    const stopFirst = store.subscribe(vi.fn());
    const stopLast = store.subscribe(vi.fn());
    const pending = store.fetch();
    await Promise.resolve();
    stopFirst();
    stopFirst();
    expect(signal.aborted).toBe(false);
    stopLast();
    expect(signal.aborted).toBe(true);
    response.resolve("late");
    await pending;
    expect(store.getSnapshot()).toMatchObject({ status: "idle", data: undefined });
  });

  it("retains unused responses for the full gcTime beyond the timer limit", async () => {
    vi.useFakeTimers();
    const timerLimit = 2_147_483_647;
    const gcTime = timerLimit + 1000;
    const store = createFetchCache({ gcTime, staleTime: Infinity }).getStore(["apps"], () =>
      Promise.resolve("data"),
    );
    await store.fetch();
    vi.advanceTimersByTime(timerLimit);
    expect(store.getSnapshot().data).toBe("data");
    vi.advanceTimersByTime(999);
    expect(store.getSnapshot().data).toBe("data");
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().status).toBe("idle");
  });

  it("cancels a chunked eviction while subscribed and restarts retention on unsubscribe", async () => {
    vi.useFakeTimers();
    const timerLimit = 2_147_483_647;
    const gcTime = timerLimit + 1000;
    const store = createFetchCache({ gcTime }).getStore(["apps"], () => Promise.resolve("data"));
    await store.fetch();
    vi.advanceTimersByTime(timerLimit);
    const stop = store.subscribe(vi.fn());
    vi.advanceTimersByTime(gcTime);
    expect(store.getSnapshot().data).toBe("data");
    stop();
    vi.advanceTimersByTime(gcTime - 1);
    expect(store.getSnapshot().data).toBe("data");
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().status).toBe("idle");
  });

  it("forces a new request and discards the superseded response", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const store = createFetchCache({ gcTime: Infinity }).getStore(["apps"], fetcher);
    const first = store.fetch();
    await Promise.resolve();
    const second = store.fetch({ force: true });
    expect(fetcher.mock.calls[0]?.[0].aborted).toBe(true);
    fresh.resolve("fresh");
    await second;
    const snapshot = store.getSnapshot();
    old.resolve("old");
    await first;
    expect(store.getSnapshot()).toBe(snapshot);
    expect(snapshot.data).toBe("fresh");
  });

  it("invalidates active stores and marks inactive data stale without fetching", async () => {
    const fetcher = vi.fn().mockResolvedValue("data");
    const store = createFetchCache({ gcTime: Infinity, staleTime: Infinity }).getStore(
      ["apps"],
      fetcher,
    );
    await store.fetch();
    await store.invalidate();
    expect(fetcher).toHaveBeenCalledOnce();
    await store.fetch();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const stop = store.subscribe(vi.fn());
    await store.invalidate();
    expect(fetcher).toHaveBeenCalledTimes(3);
    stop();
  });

  it("recovers from synchronous failures and deduplicates reentrant fetches", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("offline");
      })
      .mockResolvedValue("data");
    const store = createFetchCache({ gcTime: Infinity }).getStore(["apps"], fetcher);
    const stop = store.subscribe(() => {
      if (store.getSnapshot().isFetching) void store.fetch();
    });
    await store.fetch();
    expect(store.getSnapshot().error?.message).toBe("offline");
    await store.fetch();
    expect(store.getSnapshot()).toMatchObject({ data: "data", error: null, status: "ready" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    stop();
  });

  it("isolates caches and clears pending requests without publishing late data", async () => {
    const response = deferred<string>();
    const cache = createFetchCache({ gcTime: Infinity });
    const store = cache.getStore(["apps"], () => response.promise);
    const other = createFetchCache({ gcTime: Infinity }).getStore(["apps"], () =>
      Promise.resolve("other"),
    );
    const stop = store.subscribe(vi.fn());
    const pending = store.fetch();
    cache.clear();
    response.resolve("late");
    await pending;
    expect(store.getSnapshot().status).toBe("idle");
    expect(other.getSnapshot().status).toBe("idle");
    stop();
  });

  it("tracks fetch settlement through Nano Stores tasks and publishes to framework readers", async () => {
    const response = deferred<string>();
    const store = createFetchCache({ gcTime: Infinity }).getStore(
      ["tasks"],
      () => response.promise,
    );
    const listener = vi.fn();
    const stop = store.state.listen(listener);
    void store.fetch();
    expect(store.state.get().isFetching).toBe(true);
    let settled = false;
    const tasks = allTasks().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    response.resolve("loaded");
    await tasks;
    expect(store.state.get()).toMatchObject({ data: "loaded", status: "ready" });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("aborts when the last Nano Store reader leaves before a request starts", async () => {
    const fetcher = vi.fn().mockResolvedValue("unused");
    const store = createFetchCache({ gcTime: Infinity }).getStore(["cancel"], fetcher, {
      abortOnUnsubscribe: true,
    });
    const stop = store.state.listen(vi.fn());
    const pending = store.fetch();
    stop();
    await pending;
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.state.get()).toMatchObject({ status: "idle", isFetching: false });
  });

  it("does not clear a request started by a settlement listener", async () => {
    const response = deferred<string>();
    const fetcher = vi.fn().mockResolvedValueOnce("first").mockReturnValueOnce(response.promise);
    const store = createFetchCache({ gcTime: Infinity }).getStore(["reentrant"], fetcher);
    let second: Promise<void> | undefined;
    const stop = store.state.listen((snapshot) => {
      if (snapshot.data === "first" && !snapshot.isFetching) second = store.fetch({ force: true });
    });
    await store.fetch();
    expect(store.fetch()).toBe(second);
    response.resolve("second");
    await second;
    expect(store.state.get().data).toBe("second");
    stop();
  });

  it("keeps previews, deployments, and input arrays distinct", () => {
    expect(serializeCacheKey(["a", { z: 1, a: { b: 2, a: 3 } }])).toBe(
      serializeCacheKey(["a", { a: { a: 3, b: 2 }, z: 1 }]),
    );
    expect(serializeCacheKey(["a", [1, 2]])).not.toBe(serializeCacheKey(["a", [2, 1]]));
    expect(serializeCacheKey(["app", "deployment1"])).not.toBe(
      serializeCacheKey(["app", "deployment2"]),
    );
  });
});
