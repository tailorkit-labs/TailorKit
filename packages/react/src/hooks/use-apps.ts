import { useStore } from "@nanostores/react";
import { useMemo } from "react";
import { appsQueryKey, createAppsQuery } from "@tailorkit/client-core";
import type {
  AppsQueryOptions,
  QueryResult,
  TailorKitApp,
  TailorKitStore,
} from "@tailorkit/client-core";
import { useTailorkitContext } from "../components/context";

export type UseAppsOptions<TScopeNames extends string = string> = AppsQueryOptions<TScopeNames>;
export type UseAppsResult = QueryResult<TailorKitApp[]>;

export function useApps(options: UseAppsOptions = {}): UseAppsResult {
  return useAppsStore(useTailorkitContext("useApps").store, options);
}

export function useAppsStore(store: TailorKitStore, options: UseAppsOptions = {}): UseAppsResult {
  const key = appsQueryKey(options);
  const query = useMemo(() => createAppsQuery(store, options), [store, key]);
  return useStore(query.state);
}
