---
"@tailorkit/apps-server": minor
"@tailorkit/app-storage": minor
"@tailorkit/app": minor
"@tailorkit/cli": minor
"@tailorkit/core": minor
"@tailorkit/react": minor
"@tailorkit/sandbox": minor
"tailorkit": minor
---

Add the Apache-2.0 apps-server SDK with SQLite schema builders, synchronous Zod-validated queries/mutations, asynchronous external actions, atomic mutation receipts and typed browser references. Use oRPC v2 WebSockets for direct sandbox calls and server-driven query snapshots; the bridge supplies scoped platform JWTs and renews authentication. Execute actions in separate stateless isolates with typed `ctx.queries.<name>(args)` / `ctx.mutations.<name>(args)` calls and HTTPS egress; keep SQLite functions network-blocked and atomic. Actions do not retry automatically or hold database transactions across external work. Track table dependencies and rerun only active affected queries after commit.

Upload client and migration-free private server bundles to separate blob prefixes and load published code into isolated Dynamic Worker SQLite facets through apps/apps-runtime. Keep stable installation databases across deployments, trusted Effect v4 provider services, and legacy app-storage/client-only compatibility. Schema initialization and migration delivery remain deferred.
