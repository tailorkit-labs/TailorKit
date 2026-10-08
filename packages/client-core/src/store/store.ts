import { createTailorKitFetchClient } from "../client/fetch-client";
import type { TailorKitFetchClient } from "../client/fetch-client";
import { toBaseUrl } from "../client/url";
import type { TailorKitApp } from "../types";
import { createViewContextStore } from "./local/view-context";
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
  if (toBaseUrl(baseUrl).href !== toBaseUrl(client.baseUrl).href) {
    throw new Error("createTailorKitStore: baseUrl does not match the supplied fetch client.");
  }
  const apps = createAppsStore(client, initialApps);
  const meta = createMetadataStore(client);
  return {
    baseUrl: client.baseUrl,
    client,
    fetch: { apps, meta },
    views: createViewContextStore(client),
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
