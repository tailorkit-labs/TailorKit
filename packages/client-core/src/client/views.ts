import { createSlotStore } from "../store/fetch/slot";
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
    const schema = store.contract;
    return {
      apps: store.getAppsSnapshot().apps.filter((app) => matchesApp(app, scopes, appIds)),
      slot,
      activeView: schema.slots[slot]?.multiple === true ? store.views.getSnapshot() : null,
    };
  };
  if (store.getAppsSnapshot().status === "ready" && store.contract.slots[slot]?.multiple === true) {
    await createSlotStore(store.client, store.contract, queryOptions()).fetch({ force: true });
    return;
  }
  await store.fetchApps({ force: true });
  if (store.getAppsSnapshot().status !== "ready") return;
  await createSlotStore(store.client, store.contract, queryOptions()).fetch();
}
