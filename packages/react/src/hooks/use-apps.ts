import { useTailorRootContext } from "../components/context";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { TailorKitApp } from "../tailorkit";
import { matchesApp, normalizeScopeSelection } from "@tailorkit/client-core";
import type { TailorKitAppsSnapshot, TailorKitStore } from "@tailorkit/client-core";

export interface UseAppsOptions<TScopeNames extends string = string> {
  scopes?: readonly TScopeNames[];
  appIds?: readonly string[];
}

export interface UseAppsResult {
  data: TailorKitApp[] | undefined;
  error: Error | null;
  isFetching: boolean;
  isError: boolean;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  refetch: () => Promise<void>;
  status: "error" | "idle" | "loading" | "ready";
}

export function useApps(options: UseAppsOptions = {}): UseAppsResult {
  return useAppsStore(useTailorRootContext("useApps").store, options);
}
export function useAppsStore(store: TailorKitStore, options: UseAppsOptions = {}): UseAppsResult {
  const snapshot = useAppsSnapshot(store);
  const scopes = normalizeScopeSelection(options.scopes);
  const appIds = normalizeScopeSelection(options.appIds);
  const data = useMemo(
    () =>
      snapshot.status === "ready"
        ? snapshot.apps.filter((app) => matchesApp(app, scopes.scopes, appIds.scopes))
        : undefined,
    [snapshot, scopes.key, appIds.key],
  );
  const refetch = useCallback(() => store.fetchApps({ force: true }), [store]);
  return { ...toUseAppsResult(snapshot, refetch), data };
}

export function useAppsSnapshot(store: TailorKitStore): TailorKitAppsSnapshot {
  const snapshot = useSyncExternalStore(
    store.subscribeApps,
    store.getAppsSnapshot,
    store.getAppsSnapshot,
  );
  useEffect(() => {
    void store.fetchApps();
  }, [store]);
  return snapshot;
}

export function toUseAppsResult(
  snapshot: TailorKitAppsSnapshot,
  refetch: () => Promise<void>,
): UseAppsResult {
  return {
    data: snapshot.status === "ready" ? snapshot.apps : undefined,
    error: snapshot.error,
    isFetching: snapshot.isFetching,
    isError: snapshot.status === "error",
    isLoading: snapshot.status === "loading",
    isPending: snapshot.status === "idle" || snapshot.status === "loading",
    isSuccess: snapshot.status === "ready",
    refetch,
    status: snapshot.status,
  };
}
