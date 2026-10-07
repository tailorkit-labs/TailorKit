---
"@tailorkit/client-core": patch
"@tailorkit/app": patch
---

Replace TanStack Store with Nanostores for client fetch caches, preview sessions, view registration, and remote UI node state. Preserve change-only subscriptions, stable snapshots, and batched preview updates. Exposed local `state` stores now use the Nanostores atom API (`get`, `set`, and `listen`).

Migrate app query, mutation, and action state to Nanostores with its Preact adapter. Preserve shared query subscriptions, selective updates, and protection against stale call results.
