# @tailorkit/client-core

## 0.1.0-beta.23

### Patch Changes

- @tailorkit/app@0.1.0-beta.23
  - @tailorkit/client-platform@0.1.0-beta.23
  - @tailorkit/core@0.1.0-beta.23
  - @tailorkit/sandbox@0.1.0-beta.23

## 0.1.0-beta.22

### Minor Changes

- 382f569: Replace `useSlotInstances` and `useViews` with `useSlot({ slot })`. Single-view slots return one `{ app }` item per app with an enabled, supported view, without requiring registered context or calling instance resolvers. Multiple-view slots retain context-based instance resolution and return `{ app, key, metadata, data }` items. Support app and scope filters, infer result types from the slot's multiple flag, and rename the shared slot store and cache configuration to match. Cache timings remain internal and are not exposed as hook options.

### Patch Changes

- c29880d: Replace TanStack Store with Nanostores for client fetch caches, preview sessions, view registration, and remote UI node state. Preserve change-only subscriptions, stable snapshots, and batched preview updates. Exposed local `state` stores now use the Nanostores atom API (`get`, `set`, and `listen`).

  Migrate app query, mutation, and action state to Nanostores with its Preact adapter. Preserve shared query subscriptions, selective updates, and protection against stale call results.

- Updated dependencies [c29880d]
- Updated dependencies [268df1e]
  - @tailorkit/app@0.1.0-beta.22
  - @tailorkit/sandbox@0.1.0-beta.22
  - @tailorkit/client-platform@0.1.0-beta.22
  - @tailorkit/core@0.1.0-beta.22

## 0.1.0-beta.21

### Patch Changes

- 1c52fe8: Add minimal package READMEs with readable names and short descriptions.
- Updated dependencies [1c52fe8]
  - @tailorkit/app@0.1.0-beta.21
  - @tailorkit/client-platform@0.1.0-beta.21
  - @tailorkit/core@0.1.0-beta.21
  - @tailorkit/sandbox@0.1.0-beta.21

## 0.1.0-beta.20

### Minor Changes

- e2de939: Add the framework-independent client-core package with TanStack Store-backed state and endpoint clients. Fetch stores for apps, metadata, slot instances, and preview sessions are separate from local view registration and remote UI node state. React uses shared response caching and in-flight request deduplication with configurable stale and retention times, while preserving its public app and view types.

### Patch Changes

- Updated dependencies [a2ed82b]
- Updated dependencies [fc09d5b]
  - @tailorkit/core@0.1.0-beta.20
  - @tailorkit/app@0.1.0-beta.20
  - @tailorkit/client-platform@0.1.0-beta.20
  - @tailorkit/sandbox@0.1.0-beta.20
