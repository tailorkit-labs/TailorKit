import { useStore } from "@nanostores/react";
import { useMemo } from "react";
import { appsQueryKey, createViewsQuery } from "@tailorkit/client-core";
import type { ViewsQueryOptions, ViewsQueryResult } from "@tailorkit/client-core";
import { useTailorRootContext } from "../components/context";

export type { SlotItem } from "@tailorkit/client-core";
export type UseViewsOptions<
  TScopeNames extends string = string,
  TSlot extends string = string,
> = ViewsQueryOptions<TScopeNames, TSlot>;
export type UseViewsResult<TMultiple extends boolean = boolean> = ViewsQueryResult<TMultiple>;

/** Subscribe to the shared views query using React's lifecycle. */
export function useViews(options: UseViewsOptions): UseViewsResult {
  const { store } = useTailorRootContext("useViews");
  const key = appsQueryKey(options);
  const query = useMemo(() => createViewsQuery(store, options), [store, key, options.slot]);
  return useStore(query.state);
}
