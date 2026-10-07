# @tailorkit/client-core

Framework-independent client state shared by TailorKit's framework adapters.

Store implementations live in `src/store` and are exported through the package's `src/index.ts`:

- `createTailorKitStore`: app discovery, metadata, active views, and preview sessions.
- `createViewRegistry`: active view registration and ancestor context layers.
- `NodeStore`: remote UI nodes with subscriptions to individual nodes and the root.
- `createPreviewManager`: shared preview connections and verified source revisions.

```ts
import { createTailorKitStore } from "@tailorkit/client-core";

const client = createTailorKitStore("https://example.com/api/tailorkit");
const stop = client.subscribeApps(() => {
  const snapshot = client.getAppsSnapshot();
  // Update the framework adapter with the latest apps and status.
});

await client.fetchApps();

// Clean up when the adapter unmounts.
stop();
client.previews.dispose();
```

The client, view registry, and node store expose their underlying TanStack Store as `state`, allowing framework adapters to select the state they need. Snapshot getters and subscription methods remain available for integrations that expect an unsubscribe function. Use `subscribeApps` for app discovery subscriptions so the client can track whether to resume fetching when provided apps are removed.

`TailorKitApp` and `TailorKitView` are shared types; the React package re-exports them for compatibility.
