# @tailorkit/cli

## 0.1.0-beta.15

### Patch Changes

- @tailorkit/app@0.1.0-beta.15
  - @tailorkit/client-platform@0.1.0-beta.15
  - @tailorkit/core@0.1.0-beta.15

## 0.1.0-beta.14

### Patch Changes

- e06e450: Upload complete preview builds to KV in bounded oRPC chunks, accept previews through a host consent page, and stream verified revisions to sandboxed app views.
- 9a8ecab: Avoid logging expected request-stream aborts while the preview tunnel reconnects.
- Updated dependencies [e06e450]
  - @tailorkit/core@0.1.0-beta.14
  - @tailorkit/client-platform@0.1.0-beta.14
  - @tailorkit/app@0.1.0-beta.14

## 0.1.0-beta.13

### Patch Changes

- 061adb2: Serve preview assets directly through the authenticated tunnel without starting a local HTTP server, and end preview sessions when the CLI exits or cannot establish its tunnel.
- Updated dependencies [061adb2]
  - @tailorkit/client-platform@0.1.0-beta.13
  - @tailorkit/core@0.1.0-beta.13
  - @tailorkit/app@0.1.0-beta.13

## 0.1.0-beta.12

### Patch Changes

- @tailorkit/app@0.1.0-beta.12
  - @tailorkit/client-platform@0.1.0-beta.12
  - @tailorkit/core@0.1.0-beta.12

## 0.1.0-beta.11

### Patch Changes

- 54eb091: Use a typed oRPC WebSocket client for local preview tunnels and generate the platform HTTP client from the OpenAPI schema.
- Updated dependencies [54eb091]
  - @tailorkit/client-platform@0.1.0-beta.11
  - @tailorkit/core@0.1.0-beta.11
  - @tailorkit/app@0.1.0-beta.11

## 0.1.0-beta.10

### Patch Changes

- a0d3233: Add authenticated local preview tunnels with bounded asset delivery and secure host-side asset proxying.
- Updated dependencies [a0d3233]
  - @tailorkit/core@0.1.0-beta.10
  - @tailorkit/app@0.1.0-beta.10

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

## 0.1.0-beta.8

### Patch Changes

- Updated dependencies [9e46a8b]
  - @tailorkit/app@0.1.0-beta.8
  - @tailorkit/core@0.1.0-beta.8

## 0.1.0-beta.7

### Patch Changes

- 2e7b3a4: Add optional light and dark app logos to the deployment pipeline, including validated SVG, PNG, and WebP uploads, hosted logo URLs, and a 1 MiB combined client asset limit.
- Updated dependencies [2e7b3a4]
  - @tailorkit/app@0.1.0-beta.7
  - @tailorkit/core@0.1.0-beta.7

## 0.1.0-beta.6

### Patch Changes

- @tailorkit/app@0.1.0-beta.6
  - @tailorkit/core@0.1.0-beta.6

## 0.1.0-beta.5

### Patch Changes

- Updated dependencies [695cdad]
  - @tailorkit/core@0.1.0-beta.5
  - @tailorkit/app@0.1.0-beta.5

## 0.1.0-beta.4

### Patch Changes

- 324b281: Resolve public packages to compiled distribution files in both development and production, without custom source export conditions.

  Remove stale source aliases and declaration maps that reference unpublished source files. Generate apps with a single tailorkit dependency and its app subpath exports.

- Updated dependencies [324b281]
  - @tailorkit/app@0.1.0-beta.4
  - @tailorkit/core@0.1.0-beta.4

## 0.1.0-beta.3

### Patch Changes

- Updated dependencies [a02ebee]
  - @tailorkit/app@0.1.0-beta.3
  - @tailorkit/core@0.1.0-beta.3

## 0.1.0-beta.2

### Patch Changes

- Updated dependencies [586cc14]
  - @tailorkit/core@0.1.0-beta.2
  - @tailorkit/app@0.1.0-beta.2

## 0.1.0-beta.1

### Patch Changes

- Updated dependencies [c0bdd68]
  - @tailorkit/core@0.1.0-beta.1
  - @tailorkit/app@0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- 4230689: Publish the initial TailorKit beta packages.

### Patch Changes

- Updated dependencies [4230689]
  - @tailorkit/app@0.1.0-beta.0
  - @tailorkit/core@0.1.0-beta.0
