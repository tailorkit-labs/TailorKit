import { createSlotInstancesStore } from "@tailorkit/client-core";
import type { FetchCacheOptions, TailorKitApp } from "@tailorkit/client-core";
import type { ViewInstance } from "@tailorkit/app/client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useTailorRootContext } from "../components/context";
import type { UseAppsResult } from "./use-apps";
import { useStableContext } from "./use-stable-context";

export type SlotInstance = ViewInstance;

export interface UseSlotInstancesOptions<TSlot extends string = string> extends FetchCacheOptions {
  app: TailorKitApp;
  slot: TSlot;
}

export interface UseSlotInstancesResult extends Omit<UseAppsResult, "data"> {
  data: SlotInstance[] | undefined;
}

export function useSlotInstances({
  app,
  slot,
  staleTime,
  gcTime,
}: UseSlotInstancesOptions): UseSlotInstancesResult {
  const { store } = useTailorRootContext("useSlotInstances");
  const activeView = useSyncExternalStore(
    store.views.subscribe,
    store.views.getSnapshot,
    store.views.getSnapshot,
  );
  const options = useStableContext({ app, slot, activeView });
  const query = useMemo(
    () => createSlotInstancesStore(store.client, { ...options, staleTime, gcTime }),
    [store.client, options, staleTime, gcTime],
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
