# @tailorkit/client-core

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
