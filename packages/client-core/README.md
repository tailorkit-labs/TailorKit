# @tailorkit/client-core

Framework-independent endpoint clients and state shared by TailorKit's framework adapters.

All stores live under `src/store` and are exported from `src/index.ts`. Separate entry points keep fetch state independent of local state:

- `@tailorkit/client-core/client`: endpoint transport, shared client cache, and app/view resolution helpers.
- `@tailorkit/client-core/store/fetch`: app discovery, metadata, slot instances, preview sessions, and the response cache.
- `@tailorkit/client-core/store/local`: `NodeStore` and `createViewRegistry` for remote UI nodes and active view context.

`createEndpointClient` exposes uncached endpoint calls independently of stores. Fetch stores expose snapshot getters, subscriptions, fetch, and invalidation methods without requiring a framework adapter to access TanStack Store. This separation allows a future adapter to use its own fetch layer, such as TanStack Query, while retaining the local stores and endpoint transport. The built-in cache currently uses TanStack Store.

```ts
import { createTailorKitFetchClient, createTailorKitStore } from "@tailorkit/client-core";

const client = createTailorKitFetchClient({
  baseUrl: "https://example.com/api/tailorkit",
  cache: {
    staleTime: 30_000,
    gcTime: 300_000,
    apps: { staleTime: 60_000 },
    meta: { staleTime: Infinity },
    slotInstances: { staleTime: 10_000 },
  },
});

// Share a client across roots to share responses and in-flight requests.
// Each root retains its own active view registry and supplied app overrides.
const root = createTailorKitStore(client.baseUrl, undefined, client);
const stop = root.subscribeApps(() => {
  const snapshot = root.getAppsSnapshot();
  // Update the framework adapter with apps, status, error, and isFetching.
});

await root.fetchApps();
await root.fetchApps({ force: true });

stop();
root.previews.dispose();
```

Successful responses are fresh for 30 seconds by default. Mounting a consumer or calling `fetch()` reuses fresh data and refreshes stale data; stale times do not start polling. `staleTime: 0` always refreshes, while `Infinity` keeps successful data fresh until invalidated or explicitly refetched. Background requests retain successful data and set `isFetching`.

Unused responses are retained for five minutes by default. `gcTime` controls eviction after the last subscriber leaves or an unobserved request finishes. Concurrent consumers share a request; slot requests are cancelled when their last subscriber leaves, and superseded responses cannot overwrite newer data. Slot cache keys include the app, deployment, preview session, slot, and active view context.

Caches belong to a client instance. Create a new client when the authenticated identity changes; `client.clear()` discards responses and session providers. User-supplied apps remain authoritative for their root and do not seed the shared endpoint cache. Views derive from the same cached apps response.

React's `createTailorKitClient` accepts the same `cache` configuration and an optional `fetch` implementation. `useApps` and `useViews` accept a `staleTime` override; `useSlotInstances` also accepts `gcTime`. Their `refetch()` methods force a new request.

`TailorKitApp` and `TailorKitView` are shared types; the React package re-exports them for compatibility.
