import { useTailorRootContext } from "../components/context";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { TailorKitApp } from "../tailorkit";
import type { TailorKitAppsSnapshot, TailorKitStore } from "../store";
import { normalizeScopeSelection } from "../scope-query";

export interface UseAppsOptions<TScopeNames extends string = string> {
  scopes?: readonly TScopeNames[];
}

export interface UseAppsResult {
  data: TailorKitApp[] | undefined;
  error: Error | null;
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
  const selection = normalizeScopeSelection(options.scopes);
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeApps(selection.scopes, listener),
    [store, selection.key],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => store.getAppsSnapshot(selection.scopes),
    () => store.getAppsSnapshot(selection.scopes),
  );

  useEffect(() => {
    void store.fetchApps({ scopes: selection.scopes });
  }, [store, selection.key]);

  const refetch = useCallback(
    () => store.fetchApps({ force: true, scopes: selection.scopes }),
    [store, selection.key],
  );

  return toUseAppsResult(snapshot, refetch);
}

function toUseAppsResult(
  snapshot: TailorKitAppsSnapshot,
  refetch: () => Promise<void>,
): UseAppsResult {
  return {
    data: snapshot.status === "ready" ? snapshot.apps : undefined,
    error: snapshot.error,
    isError: snapshot.status === "error",
    isLoading: snapshot.status === "loading",
    isPending: snapshot.status === "idle" || snapshot.status === "loading",
    isSuccess: snapshot.status === "ready",
    refetch,
    status: snapshot.status,
  };
}
