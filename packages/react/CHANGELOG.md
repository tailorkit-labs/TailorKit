# @tailorkit/react

## 0.1.0-beta.21

### Patch Changes

- 1c52fe8: Add minimal package READMEs with readable names and short descriptions.
- Updated dependencies [1c52fe8]
  - @tailorkit/app@0.1.0-beta.21
  - @tailorkit/client-core@0.1.0-beta.21
  - @tailorkit/client-platform@0.1.0-beta.21
  - @tailorkit/core@0.1.0-beta.21
  - @tailorkit/sandbox@0.1.0-beta.21

## 0.1.0-beta.20

### Minor Changes

- 11b46f8: Change `useSlotInstances` to accept only `{ slot }` and discover matching instances across all apps through `useApps`. Include the source `app` on each instance, resolve apps in parallel, and preserve app-specific managed Slot rendering.
- a2ed82b: Declare multi-instance host slots with `multiple: true` (omitted or false means single-instance). Client-bound `Slot` requires `instanceKey` for multi-instance slots and rejects it for single-instance slots; ready `Slot.Controlled` similarly requires or rejects `instance`.

  Breaking change: rename `createView` to `defineView`, use `defineView({ slot, view, component, ... })` and regenerate app bindings. Multi-instance slots require `instances: { dataSchema, resolve }`; single-instance slots reject it. View registration is restricted to the slot selected in `defineView`. The CLI scaffolds a resolver when the selected host slot supports multiple instances.

- e2de939: Add the framework-independent client-core package with TanStack Store-backed state and endpoint clients. Fetch stores for apps, metadata, slot instances, and preview sessions are separate from local view registration and remote UI node state. React uses shared response caching and in-flight request deduplication with configurable stale and retention times, while preserving its public app and view types.

### Patch Changes

- Updated dependencies [a2ed82b]
- Updated dependencies [fc09d5b]
- Updated dependencies [e2de939]
  - @tailorkit/core@0.1.0-beta.20
  - @tailorkit/app@0.1.0-beta.20
  - @tailorkit/client-platform@0.1.0-beta.20
  - @tailorkit/client-core@0.1.0-beta.20
  - @tailorkit/sandbox@0.1.0-beta.20

## 0.1.0-beta.19

### Minor Changes

- fa05f02: Breaking change: rename the client-bound `useView` hook to `useRegisterView` and its exported `UseView` type to `UseRegisterView`. Update client destructuring, re-exports, imports, and calls to use the new names. The hook's arguments and registration lifecycle are unchanged.
- fa05f02: Breaking change: replace `AppView` and `AppViewProps` with client-bound `Slot` and `Slot.Controlled`. Use `<Slot app={app} name="panel" />` for registered view matching. For explicit rendering, `Slot.Controlled` requires a view, status, and complete combined context when ready, and renders the exact view without reading the registry or falling back to ancestors. The old `fallback` and `createIframe` props are no longer exposed.
- fa05f02: Add client-bound `useSlotInstances({ app, slot })` to fetch instances through the authenticated app action endpoint using the matching view and registered ancestor context. Expose loading, errors, and refetch; clear stale data when context or deployment changes. Preserve disabled view paths in manifests so host matching respects blocked fallback, while keeping them out of `useViews` discovery.
- fa05f02: Render dynamic view instances with `Slot instanceKey` or an explicit `Slot.Controlled instance`. Pass the selected instance through the sandbox and expose its validated data through the typed `view.useInstance()` hook. Handle pending requests, resolver errors, and missing keys, and reset view component state when the selected key changes.
- fa05f02: Add client-bound useViews with scopes, appIds, and slot filters. App builds and deployments include view manifests, including preview builds. useApps and useViews share one authenticated app request and filter locally; useApps also accepts appIds. Apps without a view manifest must be redeployed to appear in useViews.

### Patch Changes

- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
  - @tailorkit/app@0.1.0-beta.19
  - @tailorkit/sandbox@0.1.0-beta.19
  - @tailorkit/core@0.1.0-beta.19
  - @tailorkit/client-platform@0.1.0-beta.19

## 0.1.0-beta.18

### Minor Changes

- 731e066: Rename host `contexts` declarations to `views` to match slot view references. Replace the `contexts` configuration key and schema property with `views`; each path still maps directly to its data schema. View selection, context composition, and the serialized schema format are unchanged.

### Patch Changes

- Updated dependencies [fc9538d]
- Updated dependencies [6f969e3]
- Updated dependencies [731e066]
  - @tailorkit/app@0.1.0-beta.18
  - @tailorkit/core@0.1.0-beta.18
  - @tailorkit/client-platform@0.1.0-beta.18
  - @tailorkit/sandbox@0.1.0-beta.18

## 0.1.0-beta.17

### Patch Changes

- Updated dependencies [ba00155]
- Updated dependencies [364d5cd]
- Updated dependencies [d586115]
  - @tailorkit/core@0.1.0-beta.17
  - @tailorkit/client-platform@0.1.0-beta.17
  - @tailorkit/app@0.1.0-beta.17
  - @tailorkit/sandbox@0.1.0-beta.17

## 0.1.0-beta.16

### Minor Changes

- b5c6afc: Consolidate the app SDK in @tailorkit/app and expose app client APIs through tailorkit/client and server APIs through tailorkit/server. Provide SQLite schema builders, synchronous Zod-validated queries/mutations, asynchronous external actions, atomic mutation receipts and typed browser references. Use oRPC v2 HTTP for direct sandbox calls and WebSockets for server-driven query snapshots; the bridge supplies scoped platform JWTs and renews authentication. Execute queries, mutations and actions in one private Cloudflare facet, with an ALS-backed fetch guard and local action query/mutation calls and scoped capabilities for HTTPS egress. Keep synchronous database transactions atomic. Actions do not retry automatically or hold database transactions across external work. Track table dependencies and rerun only active affected queries after commit.

  Upload client and private server bundles with committed Drizzle migrations to separate blob prefixes and load published code into isolated Dynamic Worker SQLite facets through apps/apps-worker. Keep stable installation databases across deployments, trusted Effect v4 coordination, and client-only app compatibility. Store migration sources in migrations/ and copy them to .tailorkit/migrations/. Generate migrations explicitly through tailorkit db generate using Drizzle Kit and the existing TailorKit config, without a separate Drizzle config; builds check the current schema against the latest saved snapshot without rewriting history. Apply pending migrations atomically to each installation before database calls.

  Retire the legacy app-storage SDK, app-platform package, storage CLI commands and bridged database calls. Keep the Apache-2.0 oRPC contract in @tailorkit/app/protocol and execution in the private BUSL-1.1 apps-worker worker. Share private app JWT signing/verification through @tailorkit/api-utils/app-auth, and expose host authorization through backend.resolveInstallation and /backend/session. Effect stays in server auth and trusted runtime code, outside browser entry points.

  Support client.entry and server.entry in tailorkit.config.ts, defaulting to src/client.ts and src/server.ts. Build, deployment type checks, browser/server isolation and API type imports follow the configured entries.

  Share duplicate reactive queries with TanStack Store and retry transient mutation failures with stable receipt IDs. Inline dynamic server imports into one upload, typecheck both app entries, preserve session error codes through the iframe bridge, and mount opaque-origin sandboxes without waiting for backend authentication. Cache published deployment metadata in Cloudflare KV, update it through an authenticated platform-to-worker endpoint, and populate cache misses through the platform API. Existing clients reconnect to the latest server without remounting; deployments must maintain client compatibility.

### Patch Changes

- Updated dependencies [14980bc]
- Updated dependencies [b5c6afc]
- Updated dependencies [efdac76]
- Updated dependencies [71ad08c]
  - @tailorkit/core@0.1.0-beta.16
  - @tailorkit/client-platform@0.1.0-beta.16
  - @tailorkit/app@0.1.0-beta.16
  - @tailorkit/sandbox@0.1.0-beta.16

## 0.1.0-beta.15

### Minor Changes

- d3a873e: Breaking change: remove the `Register` module augmentation and the unbound package-root `useView` export. Hosts that relied on the augmentation must migrate to helpers returned by `createTailorKitClient` (for example, `export const { AppView, useApps, useView } = tailorKit`) to retain schema-specific view and context validation. An old ambient declaration may still compile while providing no validation.

  The client-bound helpers also check that they are rendered under the matching `<Root client={tailorKit}>`; using a helper from another client throws at runtime.

### Patch Changes

- @tailorkit/client-platform@0.1.0-beta.15
  - @tailorkit/core@0.1.0-beta.15
  - @tailorkit/sandbox@0.1.0-beta.15

## 0.1.0-beta.14

### Minor Changes

- 491f715: Rename host context declarations from `views` to `contexts`. Each context path now maps directly to its Zod, Valibot, or ArkType schema.

### Patch Changes

- e06e450: Upload complete preview builds to KV in bounded oRPC chunks, accept previews through a host consent page, and stream verified revisions to sandboxed app views.
- Updated dependencies [e06e450]
  - @tailorkit/core@0.1.0-beta.14
  - @tailorkit/sandbox@0.1.0-beta.14
  - @tailorkit/client-platform@0.1.0-beta.14

## 0.1.0-beta.13

### Patch Changes

- Updated dependencies [061adb2]
  - @tailorkit/core@0.1.0-beta.13
  - @tailorkit/sandbox@0.1.0-beta.13

## 0.1.0-beta.12

### Patch Changes

- @tailorkit/core@0.1.0-beta.12
  - @tailorkit/sandbox@0.1.0-beta.12

## 0.1.0-beta.11

### Patch Changes

- @tailorkit/core@0.1.0-beta.11
  - @tailorkit/sandbox@0.1.0-beta.11

## 0.1.0-beta.10

### Patch Changes

- Updated dependencies [a0d3233]
  - @tailorkit/core@0.1.0-beta.10
  - @tailorkit/sandbox@0.1.0-beta.10

## 0.1.0-beta.9

### Minor Changes

- ced9f2f: Add slot-specific app view selection and layered host views. Host contracts now declare `views` and `slots`; app clients register `slots[name][path]`. Each slot selects one matching view and composes context only from that view and its ancestors. Unsupported matches render nothing, and `false` entries stop fallback.

  React integrations now import `Root`, `AppView`, `useApps`, and `useView` directly. Pass the client to `Root`, add a slot to every app view, publish only each view's own context, and regenerate app bindings. Registries are isolated per root.

  Each slot declares a `views` list typed against the global view definitions. Generated app bindings and explicit host mounts enforce the slot-to-view relationship, and runtime matching only considers supported view paths while retaining inherited ancestor context.

  Publish host view state with `useView(path, { context })` or `useView(path, { status })`.

  The iframe runtime is bundled from TypeScript and accepts only default-exported `defineClient()` clients. Demo clients use that same contract. View ancestry is shared between React, the sandbox, and generated bindings. `Root` supplies one app-discovery state: when `apps` is provided, `useApps()` reads it and skips network discovery.

### Patch Changes

- Updated dependencies [ced9f2f]
  - @tailorkit/core@0.1.0-beta.9
  - @tailorkit/sandbox@0.1.0-beta.9

## 0.1.0-beta.8

### Minor Changes

- 9e46a8b: Run app clients directly inside the opaque-origin iframe sandbox while preserving the validated host messaging boundary. Remove the worker runtime and Worker DOM exports, bundle Preact into app clients, preserve typed component props, and use weak callback target references.

### Patch Changes

- Updated dependencies [9e46a8b]
  - @tailorkit/sandbox@0.1.0-beta.8
  - @tailorkit/core@0.1.0-beta.8

## 0.1.0-beta.7

### Patch Changes

- 2e7b3a4: Add optional light and dark app logos to the deployment pipeline, including validated SVG, PNG, and WebP uploads, hosted logo URLs, and a 1 MiB combined client asset limit.
- Updated dependencies [2e7b3a4]
- Updated dependencies [d75e2fe]
  - @tailorkit/core@0.1.0-beta.7
  - @tailorkit/sandbox@0.1.0-beta.7

## 0.1.0-beta.6

### Patch Changes

- Updated dependencies [a33af95]
  - @tailorkit/sandbox@0.1.0-beta.6
  - @tailorkit/core@0.1.0-beta.6

## 0.1.0-beta.5

### Patch Changes

- Updated dependencies [695cdad]
  - @tailorkit/core@0.1.0-beta.5
  - @tailorkit/sandbox@0.1.0-beta.5

## 0.1.0-beta.4

### Patch Changes

- 324b281: Resolve public packages to compiled distribution files in both development and production, without custom source export conditions.

  Remove stale source aliases and declaration maps that reference unpublished source files. Generate apps with a single tailorkit dependency and its app subpath exports.

- Updated dependencies [324b281]
  - @tailorkit/core@0.1.0-beta.4
  - @tailorkit/sandbox@0.1.0-beta.4

## 0.1.0-beta.3

### Patch Changes

- a02ebee: Include development export targets in published packages so Vite consumers do not need custom resolution conditions. Expose app authoring from `tailorkit/app` and `tailorkit/app/config`.
- Updated dependencies [a02ebee]
  - @tailorkit/core@0.1.0-beta.3
  - @tailorkit/sandbox@0.1.0-beta.3

## 0.1.0-beta.2

### Patch Changes

- Updated dependencies [586cc14]
  - @tailorkit/core@0.1.0-beta.2
  - @tailorkit/sandbox@0.1.0-beta.2

## 0.1.0-beta.1

### Patch Changes

- Updated dependencies [c0bdd68]
  - @tailorkit/core@0.1.0-beta.1
  - @tailorkit/sandbox@0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- 4230689: Publish the initial TailorKit beta packages.

### Patch Changes

- Updated dependencies [4230689]
  - @tailorkit/core@0.1.0-beta.0
  - @tailorkit/sandbox@0.1.0-beta.0
