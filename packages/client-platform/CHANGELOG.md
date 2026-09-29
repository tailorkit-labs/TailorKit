# @tailorkit/client-platform

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
