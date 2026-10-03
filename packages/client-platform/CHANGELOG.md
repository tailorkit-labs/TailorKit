# @tailorkit/client-platform

## 0.1.0-beta.17

### Patch Changes

- ba00155: Remove backend.resolveInstallation configuration. Backend sessions use the existing host authenticate callback and verified scopes; the platform authorizes the app, resolves its installation and published deployment, and returns its runtime URL. Installation IDs now use the canonical app ID and token subjects represent the authorized installation scope. Data stored under previous host-selected installation IDs requires a separate migration.

## 0.1.0-beta.16

### Minor Changes

- 14980bc: Upgrade oRPC to 2.0.0-beta.40 with native v2 routing, clients, rate limiting, tracing, and WebSocket transport. Generate OpenAPI 3.2.0 specifications and the corresponding SDK.

  Breaking changes: rename the low-level action RPC from `actions.call` to `actions.execute` (HTTP path `/actions/execute`). The old action endpoint is removed. oRPC v1 clients cannot communicate with v2 servers; upgrade host servers, browser clients, and CLI clients together. REST error JSON no longer includes `status`; read the HTTP response status instead. No v1 protocol, action alias, or error-format compatibility shim is provided.

- b5c6afc: Consolidate the app SDK in @tailorkit/app and expose app client APIs through tailorkit/client and server APIs through tailorkit/server. Provide SQLite schema builders, synchronous Zod-validated queries/mutations, asynchronous external actions, atomic mutation receipts and typed browser references. Use oRPC v2 HTTP for direct sandbox calls and WebSockets for server-driven query snapshots; the bridge supplies scoped platform JWTs and renews authentication. Execute queries, mutations and actions in one private Cloudflare facet, with an ALS-backed fetch guard and local action query/mutation calls and scoped capabilities for HTTPS egress. Keep synchronous database transactions atomic. Actions do not retry automatically or hold database transactions across external work. Track table dependencies and rerun only active affected queries after commit.

  Upload client and private server bundles with committed Drizzle migrations to separate blob prefixes and load published code into isolated Dynamic Worker SQLite facets through apps/apps-worker. Keep stable installation databases across deployments, trusted Effect v4 coordination, and client-only app compatibility. Store migration sources in migrations/ and copy them to .tailorkit/migrations/. Generate migrations explicitly through tailorkit db generate using Drizzle Kit and the existing TailorKit config, without a separate Drizzle config; builds check the current schema against the latest saved snapshot without rewriting history. Apply pending migrations atomically to each installation before database calls.

  Retire the legacy app-storage SDK, app-platform package, storage CLI commands and bridged database calls. Keep the Apache-2.0 oRPC contract in @tailorkit/app/protocol and execution in the private BUSL-1.1 apps-worker worker. Share private app JWT signing/verification through @tailorkit/api-utils/app-auth, and expose host authorization through backend.resolveInstallation and /backend/session. Effect stays in server auth and trusted runtime code, outside browser entry points.

  Support client.entry and server.entry in tailorkit.config.ts, defaulting to src/client.ts and src/server.ts. Build, deployment type checks, browser/server isolation and API type imports follow the configured entries.

  Share duplicate reactive queries with TanStack Store and retry transient mutation failures with stable receipt IDs. Inline dynamic server imports into one upload, typecheck both app entries, preserve session error codes through the iframe bridge, and mount opaque-origin sandboxes without waiting for backend authentication. Cache published deployment metadata in Cloudflare KV, update it through an authenticated platform-to-worker endpoint, and populate cache misses through the platform API. Existing clients reconnect to the latest server without remounting; deployments must maintain client compatibility.

## 0.1.0-beta.15

No changes in this release.

## 0.1.0-beta.14

### Patch Changes

- e06e450: Upload complete preview builds to KV in bounded oRPC chunks, accept previews through a host consent page, and stream verified revisions to sandboxed app views.

## 0.1.0-beta.13

### Patch Changes

- 061adb2: Serve preview assets directly through the authenticated tunnel without starting a local HTTP server, and end preview sessions when the CLI exits or cannot establish its tunnel.

## 0.1.0-beta.12

No changes in this release.

## 0.1.0-beta.11

### Patch Changes

- 54eb091: Use a typed oRPC WebSocket client for local preview tunnels and generate the platform HTTP client from the OpenAPI schema.

## 0.1.0-beta.10

### Patch Changes

- a0d3233: Add authenticated local preview tunnels with bounded asset delivery and secure host-side asset proxying.

## 0.1.0-beta.9

## 0.1.0-beta.8

## 0.1.0-beta.7

### Patch Changes

- 2e7b3a4: Add optional light and dark app logos to the deployment pipeline, including validated SVG, PNG, and WebP uploads, hosted logo URLs, and a 1 MiB combined client asset limit.

## 0.1.0-beta.6

## 0.1.0-beta.5

## 0.1.0-beta.4

### Patch Changes

- 324b281: Resolve public packages to compiled distribution files in both development and production, without custom source export conditions.

  Remove stale source aliases and declaration maps that reference unpublished source files. Generate apps with a single tailorkit dependency and its app subpath exports.

## 0.1.0-beta.3

### Patch Changes

- a02ebee: Include development export targets in published packages so Vite consumers do not need custom resolution conditions. Expose app authoring from `tailorkit/app` and `tailorkit/app/config`.

## 0.1.0-beta.2

### Patch Changes

- 586cc14: Expose platform-managed app bundle URLs on permanent tenant subdomains in registry responses. Hosted apps do not require an assetsBaseUrl override or direct access to the platform's storage provider.

## 0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- 4230689: Publish the initial TailorKit beta packages.
