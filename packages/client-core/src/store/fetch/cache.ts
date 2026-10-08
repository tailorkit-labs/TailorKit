import { computedAsync } from "@nanostores/async";
import { createSnapshotStore } from "../snapshot-store";
import { atom } from "nanostores";
import type { ReadableAtom, WritableAtom } from "nanostores";

export interface FetchCacheOptions {
  /** Milliseconds before a successful response needs refreshing. Infinity keeps it fresh. */
  staleTime?: number;
  /** Milliseconds to retain an unused response. Infinity disables eviction. */
  gcTime?: number;
}

export interface FetchSnapshot<T> {
  data: T | undefined;
  error: Error | null;
  status: "idle" | "loading" | "ready" | "error";
  isFetching: boolean;
  updatedAt: number;
}

export interface FetchOptions extends Pick<FetchCacheOptions, "staleTime"> {
  force?: boolean;
}

/** A cached request and readable state shared across framework adapters. */
export interface FetchStore<T> {
  state: ReadableAtom<FetchSnapshot<T>>;
  getSnapshot: () => FetchSnapshot<T>;
  subscribe: (listener: () => void) => () => void;
  fetch: (options?: FetchOptions) => Promise<void>;
  setData: (updater: (previous: T | undefined) => T) => void;
  invalidate: () => Promise<void>;
}

const idle = <T>(): FetchSnapshot<T> => ({
  data: undefined,
  error: null,
  status: "idle",
  isFetching: false,
  updatedAt: 0,
});

type Fetcher<T> = (signal: AbortSignal) => Promise<T>;

interface Entry {
  state: WritableAtom<FetchSnapshot<unknown>>;
  controller: AbortController | null;
  pending: Promise<void> | null;
  observers: number;
  generation: number;
  invalidated: boolean;
  gcTime: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export function serializeCacheKey(key: readonly unknown[]): string {
  return JSON.stringify(key, (_name, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}

function duration(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (value < 0 || Number.isNaN(value)) throw new Error("Cache times must be non-negative.");
  return value;
}

/** A cache belongs to one authenticated client, never to the process or a global singleton. */
export function createFetchCache(defaults: FetchCacheOptions = {}) {
  const entries = new Map<string, Entry>();
  const staleTime = duration(defaults.staleTime, 30_000);
  const gcTime = duration(defaults.gcTime, 300_000);

  const reset = (entry: Entry) => {
    entry.generation += 1;
    entry.controller?.abort();
    entry.controller = null;
    entry.pending = null;
    entry.invalidated = false;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.state.set(idle());
  };

  const scheduleGc = (key: string, entry: Entry) => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    if (entry.observers || entry.pending || entry.gcTime === Infinity) return;
    const expiresAt = Date.now() + entry.gcTime;
    const arm = () => {
      entry.timer = setTimeout(
        () => {
          if (entries.get(key) !== entry || entry.observers || entry.pending) return;
          if (Date.now() < expiresAt) {
            arm();
            return;
          }
          entries.delete(key);
          reset(entry);
        },
        Math.min(Math.max(0, expiresAt - Date.now()), 2_147_483_647),
      );
      if (typeof entry.timer === "object") entry.timer.unref?.();
    };
    arm();
  };

  return {
    getStore<T>(
      input: readonly unknown[],
      fetcher: Fetcher<T>,
      options: FetchCacheOptions & { abortOnUnsubscribe?: boolean } = {},
    ): FetchStore<T> {
      const key = serializeCacheKey(input);
      const retention = duration(options.gcTime, gcTime);
      const freshness = duration(options.staleTime, staleTime);
      const getEntry = () => {
        let entry = entries.get(key);
        if (!entry) {
          entry = {
            state: atom(idle<unknown>()),
            controller: null,
            pending: null,
            observers: 0,
            generation: 0,
            invalidated: false,
            gcTime: retention,
            timer: null,
          };
          entries.set(key, entry);
          scheduleGc(key, entry);
        }
        if (retention > entry.gcTime) {
          entry.gcTime = retention;
          scheduleGc(key, entry);
        }
        return entry;
      };
      const store = {
        getSnapshot: () => getEntry().state.get() as FetchSnapshot<T>,
        subscribe(listener: () => void) {
          const entry = getEntry();
          if (entry.timer) clearTimeout(entry.timer);
          entry.timer = null;
          entry.observers += 1;
          const unsubscribe = entry.state.listen(listener);
          let active = true;
          return () => {
            if (!active) return;
            active = false;
            unsubscribe();
            entry.observers -= 1;
            if (!entry.observers && options.abortOnUnsubscribe && entry.pending) {
              entry.generation += 1;
              entry.controller?.abort();
              entry.controller = null;
              entry.pending = null;
              const previous = entry.state.get();
              entry.state.set({
                ...previous,
                status: previous.data === undefined ? "idle" : "ready",
                isFetching: false,
              });
            }
            scheduleGc(key, entry);
          };
        },
        fetch(settings: FetchOptions = {}) {
          const entry = getEntry();
          if (entry.pending && !settings.force) return entry.pending;
          const snapshot = entry.state.get();
          const age = Date.now() - snapshot.updatedAt;
          if (
            !settings.force &&
            !entry.invalidated &&
            snapshot.status === "ready" &&
            age < duration(settings.staleTime, freshness)
          )
            return Promise.resolve();
          if (entry.timer) clearTimeout(entry.timer);
          entry.timer = null;
          entry.controller?.abort();
          const controller = new AbortController();
          entry.controller = controller;
          const generation = ++entry.generation;
          let start!: () => void;
          const pending = new Promise<void>((resolve) => {
            start = () => {
              // Async owns fetching, settlement, and Nano Stores task tracking.
              const request = computedAsync(atom(controller.signal), (signal) => {
                signal.throwIfAborted();
                return fetcher(signal);
              });
              const stop = request.listen((result) => {
                if (result.state === "loading") return;
                stop();
                if (entry.generation === generation) {
                  if (result.state === "ready") {
                    entry.invalidated = false;
                    entry.state.set({
                      data: result.value,
                      error: null,
                      status: "ready",
                      isFetching: false,
                      updatedAt: Date.now(),
                    });
                  } else {
                    entry.state.set({
                      ...entry.state.get(),
                      error:
                        result.error instanceof Error
                          ? result.error
                          : new Error(String(result.error)),
                      status: "error",
                      isFetching: false,
                    });
                  }
                  if (entry.generation === generation) {
                    entry.controller = null;
                    entry.pending = null;
                    scheduleGc(key, entry);
                  }
                }
                resolve();
              });
            };
          });
          entry.pending = pending;
          const previous = entry.state.get();
          entry.state.set({
            ...previous,
            error: null,
            status: previous.data === undefined ? "loading" : "ready",
            isFetching: true,
          });
          start();
          return pending;
        },
        setData(updater: (previous: T | undefined) => T) {
          const entry = getEntry();
          entry.generation += 1;
          entry.controller?.abort();
          entry.controller = null;
          entry.pending = null;
          entry.invalidated = false;
          entry.state.set({
            data: updater(entry.state.get().data as T | undefined),
            error: null,
            status: "ready",
            isFetching: false,
            updatedAt: Date.now(),
          });
          scheduleGc(key, entry);
        },
        invalidate() {
          const entry = getEntry();
          entry.invalidated = true;
          return entry.observers ? store.fetch({ force: true }) : Promise.resolve();
        },
      };
      return { ...store, state: createSnapshotStore(store.getSnapshot, store.subscribe) };
    },
    clear() {
      for (const [key, entry] of entries) {
        reset(entry);
        if (!entry.observers) entries.delete(key);
      }
    },
  };
}

export type FetchCache = ReturnType<typeof createFetchCache>;
