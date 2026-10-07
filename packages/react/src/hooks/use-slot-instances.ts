import { createSlotInstancesStore } from "@tailorkit/client-core";
import type { TailorKitApp, SlotInstance } from "@tailorkit/client-core";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useTailorRootContext } from "../components/context";
import { useApps } from "./use-apps";
import type { UseAppsResult } from "./use-apps";
import { useStableContext } from "./use-stable-context";

export type { SlotInstance } from "@tailorkit/client-core";

export interface UseSlotInstancesOptions<TSlot extends string = string> {
  slot: TSlot;
}

export interface UseSlotInstancesResult extends Omit<UseAppsResult, "data"> {
  data: SlotInstance[] | undefined;
}

/** Resolve instances across discovered apps while sharing endpoint state in client-core. */
export function useSlotInstances({ slot }: UseSlotInstancesOptions): UseSlotInstancesResult {
  const apps = useApps();
  const instances = useResolvedSlotInstances(slot, apps.data, apps.status, apps.error);
  const refetch = useCallback(async () => {
    if (apps.isSuccess) await instances.refetch();
    else await apps.refetch();
  }, [apps.isSuccess, apps.refetch, instances.refetch]);
  return { ...instances, isFetching: apps.isFetching || instances.isFetching, refetch };
}

/** Managed Slot resolves only its explicitly supplied app. */
export function useAppSlotInstances(app: TailorKitApp, slot: string): UseSlotInstancesResult {
  return useResolvedSlotInstances(slot, [app], "ready", null);
}

function useResolvedSlotInstances(
  slot: string,
  apps: TailorKitApp[] | undefined,
  appsStatus: UseAppsResult["status"],
  appsError: Error | null,
): UseSlotInstancesResult {
  const { store } = useTailorRootContext("useSlotInstances");
  const activeView = useSyncExternalStore(
    store.views.subscribe,
    store.views.getSnapshot,
    store.views.getSnapshot,
  );
  const options = useStableContext({ apps: apps ?? [], slot, activeView });
  const query = useMemo(
    () =>
      createSlotInstancesStore(store.client, {
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
