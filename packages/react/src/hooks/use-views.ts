import { useCallback, useMemo } from "react";
import { useTailorRootContext } from "../components/context";
import type { TailorKitView } from "../tailorkit";
import { normalizeScopeSelection } from "../scope-query";
import { matchesApp, toUseAppsResult, useAppsSnapshot } from "./use-apps";
import type { UseAppsOptions, UseAppsResult } from "./use-apps";

export interface UseViewsOptions<
  TScopeNames extends string = string,
  TSlot extends string = string,
> extends UseAppsOptions<TScopeNames> {
  slot?: TSlot;
}

export interface UseViewsResult extends Omit<UseAppsResult, "data"> {
  data: TailorKitView[] | undefined;
}

export function useViews(options: UseViewsOptions = {}): UseViewsResult {
  const { store } = useTailorRootContext("useViews");
  const snapshot = useAppsSnapshot(store, options);
  const scopes = normalizeScopeSelection(options.scopes);
  const appIds = normalizeScopeSelection(options.appIds);
  const data = useMemo(
    () =>
      snapshot.status === "ready"
        ? snapshot.views.filter(
            (view) =>
              (options.slot === undefined || view.slot === options.slot) &&
              matchesApp(view.app, scopes.scopes, appIds.scopes),
          )
        : undefined,
    [snapshot, scopes.key, appIds.key, options.slot],
  );
  const refetch = useCallback(() => store.fetchApps({ force: true }), [store]);
  return { ...toUseAppsResult(snapshot, refetch), data };
}
