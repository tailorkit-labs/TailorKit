# @tailorkit/sandbox

## 0.1.0-beta.28

### Patch Changes

- Updated dependencies [a0ffa4f]
  - @tailorkit/core@0.1.0-beta.28
  - @tailorkit/app@0.1.0-beta.28

## 0.1.0-beta.27

### Patch Changes

- Updated dependencies [21761f2]
- Updated dependencies [4685874]
  - @tailorkit/core@0.1.0-beta.27
  - @tailorkit/app@0.1.0-beta.27

## 0.1.0-beta.26

### Minor Changes

- 274ead8: Replace Zod with Valibot for iframe message validation to reduce the sandbox browser bundle. Preserve strict message validation, recursive remote trees, and session limits. Exported protocol schemas are now Valibot schemas; use Valibot `parse` or `safeParse` instead of Zod schema methods.

### Patch Changes

- Updated dependencies [3fa95bc]
  - @tailorkit/core@0.1.0-beta.26
  - @tailorkit/app@0.1.0-beta.26

## 0.1.0-beta.25

### Patch Changes

- Updated dependencies [441a5a9]
  - @tailorkit/app@0.1.0-beta.25
  - @tailorkit/core@0.1.0-beta.25

## 0.1.0-beta.24

### Patch Changes

- 057cfde: Scaffold app databases in `src/db` with schema, relations and a `defineDatabase` export. Generate migrations in `src/db/migrations`, support typed synchronous Drizzle relational queries in database handlers.

  Discover app views from `src/slots/<slot-name>/*.view.tsx`, with dotted filenames mapping to nested routes and optional explicit view paths. Add `defineRoute({ shellComponent })` roots and nested slot layouts with a `Route` outlet, preserving shared layout state during navigation. Init generates a root shell with `ClientProvider`.

  Remove manual `defineClient` registration, `client.entry` configuration, and fallback discovery of `src/schema.ts` and root migrations. Apps use the file-based client and `src/db` database layout exclusively.

  Update sandbox diagnostics to describe the generated app client instead of the removed manual client API.

- 4985d4e: Replace `useViewContext`'s status union with `{ context, loading?, error? }` so query data, loading, and errors can be passed together. Keep the view path as the first argument and infer the complete context type from that path. Loading defaults to false, errors take precedence, and loading/error states omit context. Update host examples to use the new API.

  Log diagnostics for ready views with missing required context or context that does not match the server's serialized JSON Schema. Allow omitted optional context, skip loading/error states, and suppress repeated errors for unchanged inputs. Reuse the existing Zod dependency to build JSON Schema context validators.

  Move context registration, status handling, equivalent-value deduplication, metadata observation, and diagnostics into the Nanostores-backed `client-core` view context store. Export shared context types so framework adapters can reuse the behavior. React only registers and unregisters context through its lifecycle effects. Remove React forwarding modules for slot and scope helpers and import them directly from `client-core`. Share view-query options and refetch coordination in `client-core`, including awaiting queries after app-discovery retries.

  Generalize remote view state in `client-core` with Nanostores for runtime status, component registrations, and node selectors. Share iframe lifecycle, prop updates, and callback binding across adapters, keep remote views isolated, and react to component renderer updates without recreating the sandbox.

  Use Nano Stores Async for cached fetching and task tracking, and expose cache snapshots as Nano Stores with immediate subscriber cleanup. Use the official React integration for all React store reads; the Preact adapter continues using the official Preact integration.

  Move app-query filtering and result flags, reactive view-query coordination, managed/controlled slot resolution, instance checks, client URL and remote-prop construction, component aliases and client configuration, server/slot types, and primitive/theme CSS generation into client-core. Framework adapters subscribe to shared stores and provide their own rendering and lifecycle handling. Remove the unused React context memo hook. Add a framework-independent app client connection entry point so client-core and the sandbox host do not load Preact through the app client entry point.

- Updated dependencies [057cfde]
- Updated dependencies [4985d4e]
  - @tailorkit/app@0.1.0-beta.24
  - @tailorkit/core@0.1.0-beta.24

## 0.1.0-beta.23

### Patch Changes

- @tailorkit/app@0.1.0-beta.23
  - @tailorkit/core@0.1.0-beta.23

## 0.1.0-beta.22

### Patch Changes

- Updated dependencies [c29880d]
- Updated dependencies [268df1e]
  - @tailorkit/app@0.1.0-beta.22
  - @tailorkit/core@0.1.0-beta.22

## 0.1.0-beta.21

### Patch Changes

- 1c52fe8: Add minimal package READMEs with readable names and short descriptions.
- Updated dependencies [1c52fe8]
  - @tailorkit/app@0.1.0-beta.21
  - @tailorkit/core@0.1.0-beta.21

## 0.1.0-beta.20

### Patch Changes

- Updated dependencies [a2ed82b]
- Updated dependencies [fc09d5b]
  - @tailorkit/core@0.1.0-beta.20
  - @tailorkit/app@0.1.0-beta.20

## 0.1.0-beta.19

### Minor Changes

- fa05f02: Breaking change: replace `AppView` and `AppViewProps` with client-bound `Slot` and `Slot.Controlled`. Use `<Slot app={app} name="panel" />` for registered view matching. For explicit rendering, `Slot.Controlled` requires a view, status, and complete combined context when ready, and renders the exact view without reading the registry or falling back to ancestors. The old `fallback` and `createIframe` props are no longer exposed.
- fa05f02: Render dynamic view instances with `Slot instanceKey` or an explicit `Slot.Controlled instance`. Pass the selected instance through the sandbox and expose its validated data through the typed `view.useInstance()` hook. Handle pending requests, resolver errors, and missing keys, and reset view component state when the selected key changes.

### Patch Changes

- fa05f02: Add client-bound `useSlotInstances({ app, slot })` to fetch instances through the authenticated app action endpoint using the matching view and registered ancestor context. Expose loading, errors, and refetch; clear stale data when context or deployment changes. Preserve disabled view paths in manifests so host matching respects blocked fallback, while keeping them out of `useViews` discovery.
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
  - @tailorkit/app@0.1.0-beta.19
  - @tailorkit/core@0.1.0-beta.19

## 0.1.0-beta.18

### Patch Changes

- Updated dependencies [fc9538d]
- Updated dependencies [6f969e3]
- Updated dependencies [731e066]
  - @tailorkit/app@0.1.0-beta.18
  - @tailorkit/core@0.1.0-beta.18

## 0.1.0-beta.17

### Patch Changes

- Updated dependencies [ba00155]
- Updated dependencies [364d5cd]
- Updated dependencies [d586115]
  - @tailorkit/core@0.1.0-beta.17
  - @tailorkit/app@0.1.0-beta.17

## 0.1.0-beta.16

### Minor Changes

- b5c6afc: Consolidate the app SDK in @tailorkit/app and expose app client APIs through tailorkit/client and server APIs through tailorkit/server. Provide SQLite schema builders, synchronous Zod-validated queries/mutations, asynchronous external actions, atomic mutation receipts and typed browser references. Use oRPC v2 HTTP for direct sandbox calls and WebSockets for server-driven query snapshots; the bridge supplies scoped platform JWTs and renews authentication. Execute queries, mutations and actions in one private Cloudflare facet, with an ALS-backed fetch guard and local action query/mutation calls and scoped capabilities for HTTPS egress. Keep synchronous database transactions atomic. Actions do not retry automatically or hold database transactions across external work. Track table dependencies and rerun only active affected queries after commit.

  Upload client and private server bundles with committed Drizzle migrations to separate blob prefixes and load published code into isolated Dynamic Worker SQLite facets through apps/apps-worker. Keep stable installation databases across deployments, trusted Effect v4 coordination, and client-only app compatibility. Store migration sources in migrations/ and copy them to .tailorkit/migrations/. Generate migrations explicitly through tailorkit db generate using Drizzle Kit and the existing TailorKit config, without a separate Drizzle config; builds check the current schema against the latest saved snapshot without rewriting history. Apply pending migrations atomically to each installation before database calls.

  Retire the legacy app-storage SDK, app-platform package, storage CLI commands and bridged database calls. Keep the Apache-2.0 oRPC contract in @tailorkit/app/protocol and execution in the private BUSL-1.1 apps-worker worker. Share private app JWT signing/verification through @tailorkit/api-utils/app-auth, and expose host authorization through backend.resolveInstallation and /backend/session. Effect stays in server auth and trusted runtime code, outside browser entry points.

  Support client.entry and server.entry in tailorkit.config.ts, defaulting to src/client.ts and src/server.ts. Build, deployment type checks, browser/server isolation and API type imports follow the configured entries.

  Share duplicate reactive queries with TanStack Store and retry transient mutation failures with stable receipt IDs. Inline dynamic server imports into one upload, typecheck both app entries, preserve session error codes through the iframe bridge, and mount opaque-origin sandboxes without waiting for backend authentication. Cache published deployment metadata in Cloudflare KV, update it through an authenticated platform-to-worker endpoint, and populate cache misses through the platform API. Existing clients reconnect to the latest server without remounting; deployments must maintain client compatibility.

### Patch Changes

- 71ad08c: Allow sandboxed apps to make direct HTTPS requests and secure WebSocket connections while retaining opaque-origin isolation.
- Updated dependencies [14980bc]
- Updated dependencies [b5c6afc]
- Updated dependencies [efdac76]
  - @tailorkit/core@0.1.0-beta.16
  - @tailorkit/app@0.1.0-beta.16

## 0.1.0-beta.15

### Patch Changes

- @tailorkit/core@0.1.0-beta.15

## 0.1.0-beta.14

### Patch Changes

- e06e450: Upload complete preview builds to KV in bounded oRPC chunks, accept previews through a host consent page, and stream verified revisions to sandboxed app views.
- Updated dependencies [e06e450]
  - @tailorkit/core@0.1.0-beta.14

## 0.1.0-beta.13

### Patch Changes

- Updated dependencies [061adb2]
  - @tailorkit/core@0.1.0-beta.13

## 0.1.0-beta.12

### Patch Changes

- @tailorkit/core@0.1.0-beta.12

## 0.1.0-beta.11

### Patch Changes

- @tailorkit/core@0.1.0-beta.11

## 0.1.0-beta.10

### Patch Changes

- Updated dependencies [a0d3233]
  - @tailorkit/core@0.1.0-beta.10

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

## 0.1.0-beta.8

### Minor Changes

- 9e46a8b: Run app clients directly inside the opaque-origin iframe sandbox while preserving the validated host messaging boundary. Remove the worker runtime and Worker DOM exports, bundle Preact into app clients, preserve typed component props, and use weak callback target references.

## 0.1.0-beta.7

### Patch Changes

- d75e2fe: Fix TailorKit sandbox workers served from package paths by Vite development servers so injected HMR imports resolve inside the isolated worker runtime.

## 0.1.0-beta.6

### Patch Changes

- a33af95: Send same-origin credentials when loading the sandbox runtime so protected preview deployments can serve the emitted worker asset.

## 0.1.0-beta.5

## 0.1.0-beta.4

### Patch Changes

- 324b281: Resolve public packages to compiled distribution files in both development and production, without custom source export conditions.

  Remove stale source aliases and declaration maps that reference unpublished source files. Generate apps with a single tailorkit dependency and its app subpath exports.

## 0.1.0-beta.3

### Patch Changes

- a02ebee: Include development export targets in published packages so Vite consumers do not need custom resolution conditions. Expose app authoring from `tailorkit/app` and `tailorkit/app/config`.

## 0.1.0-beta.2

## 0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- 4230689: Publish the initial TailorKit beta packages.
