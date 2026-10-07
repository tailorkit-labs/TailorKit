import { createStore } from "@tanstack/store";
import type { TailorKitFetchClient } from "../../client/fetch-client";
import { listViews } from "../../client/apps";
import type { TailorKitApp, TailorKitView } from "../../types";
import type { FetchOptions, FetchSnapshot } from "./cache";

export interface TailorKitAppsSnapshot {
  apps: TailorKitApp[];
  views: TailorKitView[];
  error: Error | null;
  status: FetchSnapshot<unknown>["status"];
  isFetching: boolean;
}

export function createAppsStore(client: TailorKitFetchClient, initialApps?: TailorKitApp[]) {
  const query = client.apps();
  const provided = createStore(initialApps);
  const suppliedSnapshot = (apps: TailorKitApp[]): TailorKitAppsSnapshot => ({
    apps,
    views: listViews(apps),
    error: null,
    status: "ready",
    isFetching: false,
  });
  let supplied = initialApps === undefined ? null : suppliedSnapshot(initialApps);
  let last: FetchSnapshot<TailorKitApp[]> | undefined;
  let snapshot: TailorKitAppsSnapshot;
  let requested = false;
  let subscribers = 0;
  let lastApps: TailorKitApp[] | undefined;
  let views: TailorKitView[] = [];
  const empty: TailorKitApp[] = [];
  const store = {
    getSnapshot(): TailorKitAppsSnapshot {
      if (supplied) return supplied;
      const current = query.getSnapshot();
      if (current !== last) {
        const apps = current.data ?? empty;
        if (apps !== lastApps) {
          views = listViews(apps);
          lastApps = apps;
        }
        snapshot = {
          apps,
          views,
          error: current.error,
          status: current.status,
          isFetching: current.isFetching,
        };
        last = current;
      }
      return snapshot;
    },
    subscribe(listener: () => void) {
      subscribers += 1;
      const stopProvided = provided.subscribe(listener).unsubscribe;
      const stopQuery = query.subscribe(() => {
        if (!supplied) listener();
      });
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        stopProvided();
        stopQuery();
        subscribers -= 1;
      };
    },
    fetch(options: FetchOptions = {}) {
      requested = true;
      return supplied ? Promise.resolve() : query.fetch(options);
    },
    refresh() {
      return requested ? store.fetch({ force: true }) : Promise.resolve();
    },
    setProvidedApps(apps: TailorKitApp[] | undefined) {
      if (provided.state === apps) return;
      supplied = apps === undefined ? null : suppliedSnapshot(apps);
      provided.setState(() => apps);
      if (!supplied && requested && subscribers) void store.fetch({ force: true });
    },
    updateViews(appId: string, appViews: NonNullable<TailorKitApp["views"]>) {
      const update = (apps: TailorKitApp[]) =>
        apps.map((app) => (app.id === appId ? { ...app, views: appViews } : app));
      if (supplied) {
        store.setProvidedApps(update(supplied.apps));
      } else {
        const apps = query.getSnapshot().data;
        if (apps?.some((app) => app.id === appId)) {
          query.setData(() => update(apps));
        }
      }
    },
    invalidate: () => (supplied ? Promise.resolve() : query.invalidate()),
  };
  return store;
}
