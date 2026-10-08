import { useMemo } from "react";
import { appsQueryKey, createViewsQuery } from "@tailorkit/client-core";
import type { SlotItem, ViewsQueryOptions } from "@tailorkit/client-core";
import { useTailorRootContext } from "../components/context";
import { useQueryResult } from "./use-query-result";
import type { UseQueryResult } from "./use-query-result";

export type { SlotItem } from "@tailorkit/client-core";
export type UseViewsOptions<
  TScopeNames extends string = string,
  TSlot extends string = string,
> = ViewsQueryOptions<TScopeNames, TSlot>;
export type UseViewsResult<TMultiple extends boolean = boolean> = UseQueryResult<
  SlotItem<TMultiple>[]
>;

/** Subscribe to the shared views query using React's lifecycle. */
export function useViews(options: UseViewsOptions): UseViewsResult {
  const { store } = useTailorRootContext("useViews");
  const key = appsQueryKey(options);
  const query = useMemo(() => createViewsQuery(store, options), [store, key, options.slot]);
  return useQueryResult(query.state);
}
