---
"@tailorkit/react": minor
"@tailorkit/core": minor
"@tailorkit/client-core": minor
---

Replace `useViewContext`'s status union with `{ context, loading?, error? }` so query data, loading, and errors can be passed together. Keep the view path as the first argument and infer the complete context type from that path. Loading defaults to false, errors take precedence, and loading/error states omit context. Update host examples to use the new API.

Log diagnostics for ready views with missing required context or context that does not match the server's serialized JSON Schema. Allow omitted optional context, skip loading/error states, and suppress repeated errors for unchanged inputs. Reuse the existing Zod dependency to build JSON Schema context validators.

Move context registration, status handling, equivalent-value deduplication, metadata observation, and diagnostics into the Nanostores-backed `client-core` view context store. Export shared context types so framework adapters can reuse the behavior. React only registers and unregisters context through its lifecycle effects. Remove React forwarding modules for slot and scope helpers and import them directly from `client-core`. Share view-query options and refetch coordination in `client-core`, including awaiting queries after app-discovery retries.

Generalize remote view state in `client-core` with Nanostores for runtime status, component registrations, and node selectors. Share iframe lifecycle, prop updates, and callback binding across adapters, keep remote views isolated, and react to component renderer updates without recreating the sandbox.

Use Nano Stores Async for cached fetching and task tracking, and expose cache snapshots as Nano Stores with immediate subscriber cleanup. Use the official React integration for all React store reads; the Preact adapter continues using the official Preact integration.
