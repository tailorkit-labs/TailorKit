---
"@tailorkit/react": minor
"@tailorkit/client-core": minor
---

Unify single-view discovery and multiple-instance resolution in `useViews({ slot })`, replacing `useSlotInstances` and the former manifest-only `useViews` implementation. Single-view slots return one `{ app }` item per app with an enabled, supported view, without requiring registered context or calling instance resolvers. Multiple-view slots retain context-based instance resolution and return `{ app, key, metadata, data }` items. Support app and scope filters, infer result types from the slot's multiple flag, and rename the shared slot store and cache configuration to match. Cache timings remain internal and are not exposed as hook options.

Rename `useRegisterView` to `useViewContext` and its exported hook type to `UseViewContext`, with the same typed arguments and registration lifecycle. Update examples and documentation to use the new hooks without compatibility aliases.
