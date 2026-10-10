import { createTailorKitFetchClient } from "../client/fetch-client";
import type { TailorKitFetchClient } from "../client/fetch-client";
import { toBaseUrl } from "../client/url";
import type { TailorKitContract } from "@tailorkit/core/schema";
import type { TailorKitApp } from "../types";
import { createViewContextStore } from "./local/view-context";
import { createAppsStore } from "./fetch/apps";
import { createPreviewManager } from "./fetch/preview-manager";

export type TailorKitStore = ReturnType<typeof createTailorKitStore>;

/** Compose independent fetch stores and local view state for one root. */
export function createTailorKitStore(options: {
  baseUrl: string | URL;
  contract: TailorKitContract;
  tools?: import("@tailorkit/core/schema").ToolImplementations<
    TailorKitContract["tools"],
    "client"
  >;
  apps?: TailorKitApp[];
  client?: TailorKitFetchClient;
  assetsBaseUrl?: string | URL;
}) {
  const { baseUrl, contract, assetsBaseUrl, apps: initialApps } = options;
  const client =
    options.client ?? createTailorKitFetchClient({ baseUrl, contract, tools: options.tools });
  if (toBaseUrl(baseUrl).href !== toBaseUrl(client.baseUrl).href) {
    throw new Error("createTailorKitStore: baseUrl does not match the supplied fetch client.");
  }
  const apps = createAppsStore(client, initialApps);
  return {
    baseUrl: client.baseUrl,
    contract,
    assetsBaseUrl,
    client,
    fetch: { apps },
    views: createViewContextStore(contract),
    setProvidedApps: apps.setProvidedApps,
    fetchApps: apps.fetch,
    getAppsSnapshot: apps.getSnapshot,
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
