import { createFetchCache } from "../store/fetch/cache";
import type { FetchCacheOptions } from "../store/fetch/cache";
import { createEndpointClient } from "./endpoints";

export interface TailorKitCacheOptions extends FetchCacheOptions {
  apps?: FetchCacheOptions;
  slot?: FetchCacheOptions;
}

export interface TailorKitFetchClientOptions {
  contract?: import("@tailorkit/core/schema").TailorKitContract;
  tools?: import("@tailorkit/core/schema").ToolImplementations<
    import("@tailorkit/core/schema").TailorKitContract["tools"],
    "client"
  >;
  baseUrl: string | URL;
  fetch?: typeof fetch;
  cache?: TailorKitCacheOptions;
}

/** Share this client between roots to share endpoint requests and cached responses. */
export function createTailorKitFetchClient(options: TailorKitFetchClientOptions) {
  const endpoints = createEndpointClient(options);
  const cache = createFetchCache(options.cache);
  const baseUrl = endpoints.baseUrl;
  const prefix = ["tailorkit", baseUrl.toString()] as const;
  return {
    baseUrl,
    endpoints,
    cache,
    cacheOptions: options.cache,
    apps: (settings: FetchCacheOptions = {}) =>
      cache.getStore([...prefix, "apps"], endpoints.apps, { ...options.cache?.apps, ...settings }),
    clear() {
      cache.clear();
      endpoints.clearSessions();
    },
  };
}

export type TailorKitFetchClient = ReturnType<typeof createTailorKitFetchClient>;
