# tailorkit

## 0.1.0-beta.24

### Minor Changes

- 057cfde: Scaffold app databases in `src/db` with schema, relations and a `defineDatabase` export. Generate migrations in `src/db/migrations`, support typed synchronous Drizzle relational queries in database handlers.

  Discover app views from `src/slots/<slot-name>/*.view.tsx`, with dotted filenames mapping to nested routes and optional explicit view paths. Add `defineRoute({ shellComponent })` roots and nested slot layouts with a `Route` outlet, preserving shared layout state during navigation. Init generates a root shell with `ClientProvider`.

  Remove manual `defineClient` registration, `client.entry` configuration, and fallback discovery of `src/schema.ts` and root migrations. Apps use the file-based client and `src/db` database layout exclusively.

  Update sandbox diagnostics to describe the generated app client instead of the removed manual client API.

### Patch Changes

- Updated dependencies [057cfde]
- Updated dependencies [4985d4e]
  - @tailorkit/app@0.1.0-beta.24
  - @tailorkit/cli@0.1.0-beta.24
  - @tailorkit/react@0.1.0-beta.24
  - @tailorkit/core@0.1.0-beta.24

## 0.1.0-beta.23

### Patch Changes

- Updated dependencies [754f2d3]
  - @tailorkit/react@0.1.0-beta.23
  - @tailorkit/app@0.1.0-beta.23
  - @tailorkit/cli@0.1.0-beta.23
  - @tailorkit/core@0.1.0-beta.23

## 0.1.0-beta.22

### Patch Changes

- Updated dependencies [c29880d]
- Updated dependencies [589ffae]
- Updated dependencies [268df1e]
- Updated dependencies [382f569]
  - @tailorkit/app@0.1.0-beta.22
  - @tailorkit/react@0.1.0-beta.22
  - @tailorkit/cli@0.1.0-beta.22
  - @tailorkit/core@0.1.0-beta.22

## 0.1.0-beta.21

### Patch Changes

- 1c52fe8: Add minimal package READMEs with readable names and short descriptions.
- Updated dependencies [1c52fe8]
  - @tailorkit/app@0.1.0-beta.21
  - @tailorkit/cli@0.1.0-beta.21
  - @tailorkit/core@0.1.0-beta.21
  - @tailorkit/react@0.1.0-beta.21

## 0.1.0-beta.20

### Minor Changes

- a2ed82b: Declare multi-instance host slots with `multiple: true` (omitted or false means single-instance). Client-bound `Slot` requires `instanceKey` for multi-instance slots and rejects it for single-instance slots; ready `Slot.Controlled` similarly requires or rejects `instance`.

  Breaking change: rename `createView` to `defineView`, use `defineView({ slot, view, component, ... })` and regenerate app bindings. Multi-instance slots require `instances: { dataSchema, resolve }`; single-instance slots reject it. View registration is restricted to the slot selected in `defineView`. The CLI scaffolds a resolver when the selected host slot supports multiple instances.

### Patch Changes

- Updated dependencies [11b46f8]
- Updated dependencies [a2ed82b]
- Updated dependencies [fc09d5b]
- Updated dependencies [e2de939]
  - @tailorkit/react@0.1.0-beta.20
  - @tailorkit/core@0.1.0-beta.20
  - @tailorkit/app@0.1.0-beta.20
  - @tailorkit/cli@0.1.0-beta.20

## 0.1.0-beta.19

### Minor Changes

- fa05f02: Breaking change: rename the client-bound `useView` hook to `useRegisterView` and its exported `UseView` type to `UseRegisterView`. Update client destructuring, re-exports, imports, and calls to use the new names. The hook's arguments and registration lifecycle are unchanged.
- fa05f02: Add colocated `createView` instance resolvers with a validated data schema and automatic, typed access to registered server queries. The app build uses Oxc to extract resolvers and their dependencies into generated server actions through `_tailorkit.instances.resolve`, addressed by slot and view path, keeping their implementations out of browser bundles. Hosts discover instance support through `instances: true` in deployment and preview view manifests.
- fa05f02: Breaking change: replace `AppView` and `AppViewProps` with client-bound `Slot` and `Slot.Controlled`. Use `<Slot app={app} name="panel" />` for registered view matching. For explicit rendering, `Slot.Controlled` requires a view, status, and complete combined context when ready, and renders the exact view without reading the registry or falling back to ancestors. The old `fallback` and `createIframe` props are no longer exposed.
- fa05f02: Add client-bound `useSlotInstances({ app, slot })` to fetch instances through the authenticated app action endpoint using the matching view and registered ancestor context. Expose loading, errors, and refetch; clear stale data when context or deployment changes. Preserve disabled view paths in manifests so host matching respects blocked fallback, while keeping them out of `useViews` discovery.
- fa05f02: Render dynamic view instances with `Slot instanceKey` or an explicit `Slot.Controlled instance`. Pass the selected instance through the sandbox and expose its validated data through the typed `view.useInstance()` hook. Handle pending requests, resolver errors, and missing keys, and reset view component state when the selected key changes.
- fa05f02: Add client-bound useViews with scopes, appIds, and slot filters. App builds and deployments include view manifests, including preview builds. useApps and useViews share one authenticated app request and filter locally; useApps also accepts appIds. Apps without a view manifest must be redeployed to appear in useViews.

### Patch Changes

- fa05f02: Minify app server bundles with Oxc and allow unused core exports to be tree-shaken, keeping host routing, platform clients, and AI dependencies out of app backends that do not use them.
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
  - @tailorkit/react@0.1.0-beta.19
  - @tailorkit/app@0.1.0-beta.19
  - @tailorkit/cli@0.1.0-beta.19
  - @tailorkit/core@0.1.0-beta.19

## 0.1.0-beta.18

### Minor Changes

- 731e066: Rename host `contexts` declarations to `views` to match slot view references. Replace the `contexts` configuration key and schema property with `views`; each path still maps directly to its data schema. View selection, context composition, and the serialized schema format are unchanged.

### Patch Changes

- Updated dependencies [fc9538d]
- Updated dependencies [6f969e3]
- Updated dependencies [731e066]
  - @tailorkit/cli@0.1.0-beta.18
  - @tailorkit/app@0.1.0-beta.18
  - @tailorkit/core@0.1.0-beta.18
  - @tailorkit/react@0.1.0-beta.18

## 0.1.0-beta.17

### Patch Changes

- Updated dependencies [ba00155]
- Updated dependencies [364d5cd]
- Updated dependencies [72d38cd]
- Updated dependencies [8d1b465]
- Updated dependencies [aad1587]
- Updated dependencies [d586115]
- Updated dependencies [6569f26]
- Updated dependencies [9384481]
  - @tailorkit/core@0.1.0-beta.17
  - @tailorkit/app@0.1.0-beta.17
  - @tailorkit/cli@0.1.0-beta.17
  - @tailorkit/react@0.1.0-beta.17

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
  - @tailorkit/core@0.1.0-beta.16
  - @tailorkit/app@0.1.0-beta.16
  - @tailorkit/cli@0.1.0-beta.16
  - @tailorkit/react@0.1.0-beta.16

## 0.1.0-beta.15

### Patch Changes

- Updated dependencies [d3a873e]
  - @tailorkit/react@0.1.0-beta.15
  - @tailorkit/app@0.1.0-beta.15
  - @tailorkit/cli@0.1.0-beta.15
  - @tailorkit/core@0.1.0-beta.15

## 0.1.0-beta.14

### Minor Changes

- 491f715: Rename host context declarations from `views` to `contexts`. Each context path now maps directly to its Zod, Valibot, or ArkType schema.

### Patch Changes

- Updated dependencies [491f715]
- Updated dependencies [e06e450]
- Updated dependencies [9a8ecab]
  - @tailorkit/react@0.1.0-beta.14
  - @tailorkit/cli@0.1.0-beta.14
  - @tailorkit/core@0.1.0-beta.14
  - @tailorkit/app@0.1.0-beta.14

## 0.1.0-beta.13

### Patch Changes

- Updated dependencies [061adb2]
  - @tailorkit/cli@0.1.0-beta.13
  - @tailorkit/core@0.1.0-beta.13
  - @tailorkit/app@0.1.0-beta.13
  - @tailorkit/react@0.1.0-beta.13

## 0.1.0-beta.12

### Patch Changes

- 59ea06d: Fix the preview command when a host returns its successful session payload directly.
- @tailorkit/app@0.1.0-beta.12
  - @tailorkit/cli@0.1.0-beta.12
  - @tailorkit/core@0.1.0-beta.12
  - @tailorkit/react@0.1.0-beta.12

## 0.1.0-beta.11

### Patch Changes

- Updated dependencies [54eb091]
  - @tailorkit/cli@0.1.0-beta.11
  - @tailorkit/core@0.1.0-beta.11
  - @tailorkit/app@0.1.0-beta.11
  - @tailorkit/react@0.1.0-beta.11

## 0.1.0-beta.10

### Patch Changes

- Updated dependencies [a0d3233]
  - @tailorkit/cli@0.1.0-beta.10
  - @tailorkit/core@0.1.0-beta.10
  - @tailorkit/app@0.1.0-beta.10
  - @tailorkit/react@0.1.0-beta.10

## 0.1.0-beta.9

### Minor Changes

- ced9f2f: Add slot-specific app view selection and layered host views. Host contracts now declare `views` and `slots`; app clients register `slots[name][path]`. Each slot selects one matching view and composes context only from that view and its ancestors. Unsupported matches render nothing, and `false` entries stop fallback.

  React integrations now import `Root`, `AppView`, `useApps`, and `useView` directly. Pass the client to `Root`, add a slot to every app view, publish only each view's own context, and regenerate app bindings. Registries are isolated per root.

  Each slot declares a `views` list typed against the global view definitions. Generated app bindings and explicit host mounts enforce the slot-to-view relationship, and runtime matching only considers supported view paths while retaining inherited ancestor context.

  Publish host view state with `useView(path, { context })` or `useView(path, { status })`.

  The iframe runtime is bundled from TypeScript and accepts only default-exported `defineClient()` clients. Demo clients use that same contract. View ancestry is shared between React, the sandbox, and generated bindings. `Root` supplies one app-discovery state: when `apps` is provided, `useApps()` reads it and skips network discovery.

### Patch Changes

- Updated dependencies [ced9f2f]
  - @tailorkit/app@0.1.0-beta.9
  - @tailorkit/core@0.1.0-beta.9
  - @tailorkit/react@0.1.0-beta.9
  - @tailorkit/cli@0.1.0-beta.9

## 0.1.0-beta.8

### Patch Changes

- Updated dependencies [9e46a8b]
  - @tailorkit/app@0.1.0-beta.8
  - @tailorkit/react@0.1.0-beta.8
  - @tailorkit/cli@0.1.0-beta.8
  - @tailorkit/core@0.1.0-beta.8

## 0.1.0-beta.7

### Patch Changes

- Updated dependencies [2e7b3a4]
  - @tailorkit/app@0.1.0-beta.7
  - @tailorkit/cli@0.1.0-beta.7
  - @tailorkit/core@0.1.0-beta.7
  - @tailorkit/react@0.1.0-beta.7

## 0.1.0-beta.6

### Patch Changes

- @tailorkit/react@0.1.0-beta.6
  - @tailorkit/app@0.1.0-beta.6
  - @tailorkit/cli@0.1.0-beta.6
  - @tailorkit/core@0.1.0-beta.6

## 0.1.0-beta.5

### Patch Changes

- Updated dependencies [695cdad]
  - @tailorkit/core@0.1.0-beta.5
  - @tailorkit/app@0.1.0-beta.5
  - @tailorkit/cli@0.1.0-beta.5
  - @tailorkit/react@0.1.0-beta.5

## 0.1.0-beta.4

### Patch Changes

- 324b281: Resolve public packages to compiled distribution files in both development and production, without custom source export conditions.

  Remove stale source aliases and declaration maps that reference unpublished source files. Generate apps with a single tailorkit dependency and its app subpath exports.

- Updated dependencies [324b281]
  - @tailorkit/cli@0.1.0-beta.4
  - @tailorkit/app@0.1.0-beta.4
  - @tailorkit/core@0.1.0-beta.4
  - @tailorkit/react@0.1.0-beta.4

## 0.1.0-beta.3

### Patch Changes

- a02ebee: Include development export targets in published packages so Vite consumers do not need custom resolution conditions. Expose app authoring from `tailorkit/app` and `tailorkit/app/config`.
- Updated dependencies [a02ebee]
  - @tailorkit/app@0.1.0-beta.3
  - @tailorkit/core@0.1.0-beta.3
  - @tailorkit/react@0.1.0-beta.3
  - @tailorkit/cli@0.1.0-beta.3

## 0.1.0-beta.2

### Patch Changes

- Updated dependencies [586cc14]
  - @tailorkit/core@0.1.0-beta.2
  - @tailorkit/cli@0.1.0-beta.2
  - @tailorkit/react@0.1.0-beta.2

## 0.1.0-beta.1

### Patch Changes

- Updated dependencies [c0bdd68]
  - @tailorkit/core@0.1.0-beta.1
  - @tailorkit/cli@0.1.0-beta.1
  - @tailorkit/react@0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- 4230689: Publish the initial TailorKit beta packages.

### Patch Changes

- Updated dependencies [4230689]
  - @tailorkit/cli@0.1.0-beta.0
  - @tailorkit/core@0.1.0-beta.0
  - @tailorkit/react@0.1.0-beta.0
