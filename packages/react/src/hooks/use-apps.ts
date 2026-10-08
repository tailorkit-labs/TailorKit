import { useMemo } from "react";
import { appsQueryKey, createAppsQuery } from "@tailorkit/client-core";
import type { AppsQueryOptions, TailorKitApp, TailorKitStore } from "@tailorkit/client-core";
import { useTailorkitContext } from "../components/context";
import { useQueryResult } from "./use-query-result";
import type { UseQueryResult } from "./use-query-result";

export type UseAppsOptions<TScopeNames extends string = string> = AppsQueryOptions<TScopeNames>;
export type UseAppsResult = UseQueryResult<TailorKitApp[]>;

export function useApps(options: UseAppsOptions = {}): UseAppsResult {
  return useAppsStore(useTailorkitContext("useApps").store, options);
}

export function useAppsStore(store: TailorKitStore, options: UseAppsOptions = {}): UseAppsResult {
  const key = appsQueryKey(options);
  const query = useMemo(() => createAppsQuery(store, options), [store, key]);
  return useQueryResult(query.state);
}
