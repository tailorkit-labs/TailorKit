import { createSlotStore } from "../store/fetch/slot";
import { serializeCacheKey } from "../store/fetch/cache";
import type { TailorKitStore } from "../store/store";
import { matchesApp } from "./apps";

export interface ViewsQueryOptions<
  TScopeNames extends string = string,
  TSlot extends string = string,
> {
  slot: TSlot;
  scopes?: readonly TScopeNames[];
  appIds?: readonly string[];
}

/** Refresh discovery or instances and join queries created by the resulting state. */
export async function refetchViews(
  store: TailorKitStore,
  { slot, scopes, appIds }: ViewsQueryOptions,
): Promise<void> {
  const queryOptions = () => {
    const schema = store.getMetaSnapshot().schema;
    return {
      apps: store.getAppsSnapshot().apps.filter((app) => matchesApp(app, scopes, appIds)),
      slot,
      activeView:
        schema === null || schema.slots[slot]?.multiple === true ? store.views.getSnapshot() : null,
    };
  };
  if (
    store.getAppsSnapshot().status === "ready" &&
    store.getMetaSnapshot().schema?.slots[slot]?.multiple === true
  ) {
    await createSlotStore(store.client, queryOptions()).fetch({ force: true });
    return;
  }
  await store.fetchApps({ force: true });
  let previousKey: string | undefined;
  // Metadata can change which query owns the result, including after discovery retries.
  while (store.getAppsSnapshot().status === "ready") {
    const options = queryOptions();
    const key = serializeCacheKey([options.apps, slot, options.activeView]);
    if (key === previousKey) return;
    previousKey = key;
    await createSlotStore(store.client, options).fetch();
  }
}
