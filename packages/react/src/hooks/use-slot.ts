import { createSlotStore } from "@tailorkit/client-core";
import type { FetchCacheOptions, TailorKitApp, SlotItem } from "@tailorkit/client-core";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useTailorRootContext } from "../components/context";
import { useApps } from "./use-apps";
import type { UseAppsOptions, UseAppsResult } from "./use-apps";
import { useStableContext } from "./use-stable-context";

export type { SlotItem } from "@tailorkit/client-core";

export interface UseSlotOptions<TScopeNames extends string = string, TSlot extends string = string>
  extends UseAppsOptions<TScopeNames>, Pick<FetchCacheOptions, "gcTime"> {
  slot: TSlot;
}

export interface UseSlotResult<TMultiple extends boolean = boolean> extends Omit<
  UseAppsResult,
  "data"
> {
  data: SlotItem<TMultiple>[] | undefined;
}

/** List apps for single-view slots or resolve instances for multiple-view slots. */
export function useSlot({
  slot,
  staleTime,
  gcTime,
  scopes,
  appIds,
}: UseSlotOptions): UseSlotResult {
  const { store } = useTailorRootContext("useSlot");
  const apps = useApps({ scopes, appIds });
  const items = useResolvedSlot(slot, apps.data, apps.status, apps.error, {
    staleTime,
    gcTime,
  });
  const refetch = useCallback(async () => {
    const multiple = store.client.meta().getSnapshot().data?.schema.slots[slot]?.multiple;
    if (!apps.isSuccess) {
      await apps.refetch();
      return;
    }
    if (multiple !== true) {
      await apps.refetch();
      if (multiple !== undefined) return;
    }
    await items.refetch();
  }, [store.client, slot, apps.isSuccess, apps.refetch, items.refetch]);
  return { ...items, isFetching: apps.isFetching || items.isFetching, refetch };
}

/** Managed Slot resolves only its explicitly supplied app. */
export function useAppSlot(app: TailorKitApp, slot: string): UseSlotResult {
  return useResolvedSlot(slot, [app], "ready", null);
}

function useResolvedSlot(
  slot: string,
  apps: TailorKitApp[] | undefined,
  appsStatus: UseAppsResult["status"],
  appsError: Error | null,
  { staleTime, gcTime }: FetchCacheOptions = {},
): UseSlotResult {
  const { store } = useTailorRootContext("useSlot");
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
        staleTime,
        gcTime,
      }),
    [store.client, options, appsStatus, appsError, staleTime, gcTime],
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
