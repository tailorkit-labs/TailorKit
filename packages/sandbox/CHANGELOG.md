# @tailorkit/sandbox

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
