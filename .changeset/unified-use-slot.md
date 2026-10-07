---
"@tailorkit/react": minor
"@tailorkit/client-core": minor
---

Replace `useSlotInstances` and `useViews` with `useSlot({ slot })`. Single-view slots return one `{ app }` item per app with an enabled, supported view, without requiring registered context or calling instance resolvers. Multiple-view slots retain context-based instance resolution and return `{ app, key, metadata, data }` items. Support app and scope filters, infer result types from the slot's multiple flag, and rename the shared slot store and cache configuration to match.
