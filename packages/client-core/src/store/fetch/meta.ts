import { createSnapshotStore } from "../snapshot-store";
import type { TailorKitFetchClient } from "../../client/fetch-client";
import type { TailorKitMetadata } from "../../client/endpoints";
import type { FetchSnapshot } from "./cache";

export interface TailorKitMetaSnapshot {
  assetsBaseUrl: string | null;
  schema: TailorKitMetadata["schema"] | null;
  error: Error | null;
  status: FetchSnapshot<unknown>["status"];
  isFetching: boolean;
}

export function createMetadataStore(client: TailorKitFetchClient) {
  const query = client.meta();
  let last: FetchSnapshot<TailorKitMetadata> | undefined;
  let snapshot: TailorKitMetaSnapshot;
  const store = {
    getSnapshot(): TailorKitMetaSnapshot {
      const current = query.getSnapshot();
      if (current !== last) {
        snapshot = {
          assetsBaseUrl: current.data?.assetsBaseUrl ?? null,
          schema: current.data?.schema ?? null,
          error: current.error,
          status: current.status,
          isFetching: current.isFetching,
        };
        last = current;
      }
      return snapshot;
    },
    subscribe: query.subscribe,
    fetch: query.fetch,
    invalidate: query.invalidate,
  };
  return { ...store, state: createSnapshotStore(store.getSnapshot, store.subscribe) };
}
