import { useStore } from "@nanostores/react";
import { createSlotStore, refetchViews } from "@tailorkit/client-core";
import type { TailorKitApp, SlotItem, ViewsQueryOptions } from "@tailorkit/client-core";
import { useCallback, useEffect, useMemo } from "react";
import { useTailorRootContext } from "../components/context";
import { useApps } from "./use-apps";
import type { UseAppsResult } from "./use-apps";
import { useStableContext } from "./use-stable-context";

export type { SlotItem } from "@tailorkit/client-core";

export type UseViewsOptions<
  TScopeNames extends string = string,
  TSlot extends string = string,
> = ViewsQueryOptions<TScopeNames, TSlot>;

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
  const refetch = useCallback(
    () => refetchViews(store, { slot, scopes, appIds }),
    [store, slot, scopes, appIds],
  );
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
  const activeView = useStore(store.views.state);
  const meta = useStore(store.fetch.meta.state);
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
  const snapshot = useStore(query.state);
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
