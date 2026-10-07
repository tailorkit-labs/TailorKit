import { createSlotStore, matchesApp, serializeCacheKey } from "@tailorkit/client-core";
import type { TailorKitApp, SlotItem } from "@tailorkit/client-core";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useTailorRootContext } from "../components/context";
import { useApps } from "./use-apps";
import type { UseAppsOptions, UseAppsResult } from "./use-apps";
import { useStableContext } from "./use-stable-context";

export type { SlotItem } from "@tailorkit/client-core";

export interface UseViewsOptions<
  TScopeNames extends string = string,
  TSlot extends string = string,
> extends UseAppsOptions<TScopeNames> {
  slot: TSlot;
}

export interface UseViewsResult<TMultiple extends boolean = boolean> extends Omit<
  UseAppsResult,
  "data"
> {
  data: SlotItem<TMultiple>[] | undefined;
}

/** List apps for single-view slots or resolve instances for multiple-view slots. */
export function useViews({ slot, scopes, appIds }: UseViewsOptions): UseViewsResult {
  const { store } = useTailorRootContext("useViews");
  const apps = useApps({ scopes, appIds });
  const items = useResolvedSlot(slot, apps.data, apps.status, apps.error);
  const refetch = useCallback(async () => {
    const multiple = store.client.meta().getSnapshot().data?.schema.slots[slot]?.multiple;
    if (apps.isSuccess && multiple === true) {
      await items.refetch();
      return;
    }
    await apps.refetch();
    let previousKey: string | undefined;
    // Read live store state: React may not have rendered the discovery result yet.
    // Join the new query, including a key change when metadata identifies a single slot.
    while (true) {
      const discovery = store.getAppsSnapshot();
      if (discovery.status !== "ready") return;
      const schema = store.getMetaSnapshot().schema;
      const options = {
        apps: discovery.apps.filter((app) => matchesApp(app, scopes, appIds)),
        slot,
        activeView:
          schema === null || schema.slots[slot]?.multiple === true
            ? store.views.getSnapshot()
            : null,
      };
      const key = serializeCacheKey([options.apps, slot, options.activeView]);
      if (key === previousKey) return;
      previousKey = key;
      await createSlotStore(store.client, options).fetch();
    }
  }, [store, slot, scopes, appIds, apps.isSuccess, apps.refetch, items.refetch]);
  return { ...items, isFetching: apps.isFetching || items.isFetching, refetch };
}

/** Managed Slot resolves only its explicitly supplied app. */
export function useAppSlot(app: TailorKitApp, slot: string): UseViewsResult {
  return useResolvedSlot(slot, [app], "ready", null);
}

function useResolvedSlot(
  slot: string,
  apps: TailorKitApp[] | undefined,
  appsStatus: UseAppsResult["status"],
  appsError: Error | null,
): UseViewsResult {
  const { store } = useTailorRootContext("useViews");
  const activeView = useSyncExternalStore(
    store.views.subscribe,
    store.views.getSnapshot,
    store.views.getSnapshot,
  );
  const meta = useSyncExternalStore(store.subscribe, store.getMetaSnapshot, store.getMetaSnapshot);
  const options = useStableContext({
    apps: apps ?? [],
    slot,
    activeView:
      meta.schema === null || meta.schema.slots[slot]?.multiple === true ? activeView : null,
  });
  const query = useMemo(
    () =>
      createSlotStore(store.client, {
        ...options,
        appsStatus,
        appsError,
      }),
    [store.client, options, appsStatus, appsError],
  );
  const snapshot = useSyncExternalStore(query.subscribe, query.getSnapshot, query.getSnapshot);
  useEffect(() => {
    void query.fetch();
  }, [query]);
  const refetch = useCallback(() => query.fetch({ force: true }), [query]);
  return {
    ...snapshot,
    isError: snapshot.status === "error",
    isPending: snapshot.status === "idle" || snapshot.status === "loading",
    isLoading: snapshot.status === "loading",
    isSuccess: snapshot.status === "ready",
    refetch,
  };
}
