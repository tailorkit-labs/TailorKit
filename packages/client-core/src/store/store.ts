import { createTailorKitFetchClient } from "../client/fetch-client";
import type { TailorKitFetchClient } from "../client/fetch-client";
import type { TailorKitApp } from "../types";
import { createViewRegistry } from "./local/view-registry";
import { createAppsStore } from "./fetch/apps";
import { createMetadataStore } from "./fetch/meta";
import { createPreviewManager } from "./fetch/preview-manager";

export type TailorKitStore = ReturnType<typeof createTailorKitStore>;

/** Compose independent fetch stores and local view state for one root. */
export function createTailorKitStore(
  baseUrl: string | URL,
  initialApps?: TailorKitApp[],
  client: TailorKitFetchClient = createTailorKitFetchClient({ baseUrl }),
) {
  const apps = createAppsStore(client, initialApps);
  const meta = createMetadataStore(client);
  return {
    baseUrl: client.baseUrl,
    client,
    fetch: { apps, meta },
    views: createViewRegistry(),
    setProvidedApps: apps.setProvidedApps,
    fetchApps: apps.fetch,
    fetchMeta: meta.fetch,
    getAppsSnapshot: apps.getSnapshot,
    getMetaSnapshot: meta.getSnapshot,
    subscribe: meta.subscribe,
    subscribeApps: apps.subscribe,
    previews: createPreviewManager(
      client.baseUrl,
      () => {
        void apps.refresh();
      },
      apps.updateViews,
      client.endpoints.previewMetadata,
    ),
  };
}
