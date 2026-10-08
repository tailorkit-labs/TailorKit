import { useStore } from "@nanostores/react";
import type { QueryResult } from "@tailorkit/client-core";
import type { ReadableAtom } from "nanostores";
import { useMemo } from "react";

export type UseQueryResult<T> = Pick<QueryResult<T>, "data" | "isPending" | "error"> & {
  /** Whether a background fetch is running after the initial pending state. */
  isRefetching: boolean;
  /** Fetch fresh data, bypassing the cache's freshness window. */
  fetch: () => Promise<void>;
};

export function useQueryResult<T>(state: ReadableAtom<QueryResult<T>>): UseQueryResult<T> {
  const result = useStore(state);
  return useMemo(
    () => ({
      data: result.data,
      isPending: result.isPending,
      error: result.error,
      isRefetching: result.isFetching && !result.isPending,
      fetch: result.refetch,
    }),
    [result],
  );
}
