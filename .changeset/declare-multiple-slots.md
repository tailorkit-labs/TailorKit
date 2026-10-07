---
"@tailorkit/core": minor
"@tailorkit/react": minor
"@tailorkit/app": minor
"@tailorkit/cli": minor
"tailorkit": minor
---

Declare multi-instance host slots with `multiple: true` (omitted or false means single-instance). Client-bound `Slot` requires `instanceKey` for multi-instance slots and rejects it for single-instance slots; ready `Slot.Controlled` similarly requires or rejects `instance`.

Breaking change: use `createView({ slot, view, component, ... })` and regenerate app bindings. Multi-instance slots require `instances: { dataSchema, resolve }`; single-instance slots reject it. View registration is restricted to the slot selected in `createView`. The CLI scaffolds a resolver when the selected host slot supports multiple instances.
