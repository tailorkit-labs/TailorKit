import { computed } from "nanostores";
import type { ReadableAtom } from "nanostores";
import type { TailorKitApp } from "../types";
import type { TailorKitStore } from "./store";
import type { FetchSnapshot } from "./fetch/cache";
import { serializeCacheKey } from "./fetch/cache";
import { createSlotStore } from "./fetch/slot";
import type { SlotItem } from "./fetch/slot";
import { createSnapshotStore, switchStore } from "./snapshot-store";
import { matchesApp } from "../client/apps";
import { normalizeScopeSelection } from "../client/scope-query";
import { refetchViews } from "../client/views";
import type { ViewsQueryOptions } from "../client/views";

export interface AppsQueryOptions<TScopeNames extends string = string> {
  scopes?: readonly TScopeNames[];
  appIds?: readonly string[];
}

export interface QueryResult<T> {
  data: T | undefined;
  error: Error | null;
  status: FetchSnapshot<unknown>["status"];
  isFetching: boolean;
  isError: boolean;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  refetch: () => Promise<void>;
}

export type ViewsQueryResult<TMultiple extends boolean = boolean> = QueryResult<
  SlotItem<TMultiple>[]
>;

export function appsQueryKey(options: AppsQueryOptions): string {
  return serializeCacheKey([
    normalizeScopeSelection(options.scopes).key,
    normalizeScopeSelection(options.appIds).key,
  ]);
}

function result<T>(
  snapshot: Pick<FetchSnapshot<T>, "data" | "error" | "status" | "isFetching">,
  refetch: () => Promise<void>,
): QueryResult<T> {
  return {
    data: snapshot.data,
    error: snapshot.error,
    status: snapshot.status,
    isFetching: snapshot.isFetching,
    isError: snapshot.status === "error",
    isLoading: snapshot.status === "loading",
    isPending: snapshot.status === "idle" || snapshot.status === "loading",
    isSuccess: snapshot.status === "ready",
    refetch,
  };
}

/** Discover and filter apps, with the same result shape in every framework. */
export function createAppsQuery(store: TailorKitStore, options: AppsQueryOptions = {}) {
  const refetch = () => store.fetchApps({ force: true });
  let previous: ReturnType<typeof store.getAppsSnapshot> | undefined;
  let snapshot: QueryResult<TailorKitApp[]>;
  const state = createSnapshotStore(
    () => {
      const current = store.fetch.apps.state.get();
      if (current !== previous) {
        previous = current;
        snapshot = result(
          {
            ...current,
            data:
              current.status === "ready"
                ? current.apps.filter((app) => matchesApp(app, options.scopes, options.appIds))
                : undefined,
          },
          refetch,
        );
      }
      return snapshot;
    },
    (listener) => {
      const stop = store.fetch.apps.state.listen(listener);
      void store.fetchApps();
      return stop;
    },
  );
  return { state, refetch, fetch: store.fetchApps };
}

/** Resolve a slot reactively as discovery, metadata, and registered context change. */
export function createViewsQuery(store: TailorKitStore, options: ViewsQueryOptions) {
  return viewsQuery(store, options);
}

/** Resolve an explicitly supplied app without initiating discovery. */
export function createAppViewsQuery(store: TailorKitStore, app: TailorKitApp, slot: string) {
  return viewsQuery(store, { slot }, app);
}

function viewsQuery(store: TailorKitStore, options: ViewsQueryOptions, app?: TailorKitApp) {
  let previousKey: string | undefined;
  let previousError: Error | null | undefined;
  let selected: ReadableAtom<ViewsQueryResult>;
  let query: ReturnType<typeof createSlotStore>;
  const refetch = () => {
    selection.get();
    return app ? query.fetch({ force: true }) : refetchViews(store, options);
  };
  const selection = computed(
    [store.fetch.apps.state, store.fetch.meta.state, store.views.state],
    (discovery, metadata, active) => {
      const apps = app
        ? [app]
        : discovery.status === "ready"
          ? discovery.apps.filter((candidate) =>
              matchesApp(candidate, options.scopes, options.appIds),
            )
          : [];
      const appsStatus = app ? "ready" : discovery.status;
      const appsError = app ? null : discovery.error;
      const activeView =
        metadata.schema === null || metadata.schema.slots[options.slot]?.multiple === true
          ? active
          : null;
      const key = serializeCacheKey([apps, options.slot, activeView, appsStatus]);
      if (key !== previousKey || appsError !== previousError) {
        previousKey = key;
        previousError = appsError;
        const slot = createSlotStore(store.client, {
          apps,
          slot: options.slot,
          activeView,
          appsStatus,
          appsError,
        });
        query = slot;
        let last: ReturnType<typeof slot.getSnapshot> | undefined;
        let fetching: boolean | undefined;
        let snapshot: ViewsQueryResult;
        selected = createSnapshotStore(
          () => {
            const current = slot.state.get();
            const appsFetching = !app && store.fetch.apps.state.get().isFetching;
            if (current !== last || fetching !== appsFetching) {
              last = current;
              fetching = appsFetching;
              snapshot = result(
                { ...current, isFetching: appsFetching || current.isFetching },
                refetch,
              );
            }
            return snapshot;
          },
          (listener) => {
            const stopSlot = slot.state.listen(listener);
            const stopApps = app ? () => {} : store.fetch.apps.state.listen(listener);
            void slot.fetch();
            return () => {
              stopSlot();
              stopApps();
            };
          },
        );
      }
      return selected;
    },
  );
  const source = switchStore(selection);
  const state = createSnapshotStore(source.get, (listener) => {
    const stop = source.listen(listener);
    if (!app) void store.fetchApps();
    return stop;
  });
  return { state, refetch };
}
