Private Cloudflare application runtime, licensed under BUSL-1.1.

# App runtime

`tailorkit-apps-worker` is the trusted Cloudflare entry point for app queries, mutations, actions and subscriptions. App server bundles are uploaded by the existing CLI to the private blob bucket under `server/server.js`; client code remains under `client/client.js`. The same worker delivers public client assets and logos; its asset allowlist never serves server bundles.

The host SDK uses its existing `authenticate` callback and calls `POST /apps/{appId}/runtime/session` with its project key and verified scopes. The platform checks the app belongs to that project and one of those scopes, resolves its published deployment, and issues a short-lived ES256 JWT. No `backend.resolveInstallation` callback is required. The canonical app ID is the stable installation ID, and `userId` (JWT `sub`) is `scope:<scopeKey>` for the app's authorized scope; this represents the installation scope, not an individual person. The platform returns `https://<teamPublicId>.tailorkit.app/p/<projectId>/a/<appPublicId>/rpc`, deriving the hostname from `ASSET_DOMAIN` (default `tailorkit.app`). `APP_RUNTIME_URL` is an optional origin override for local development. The signed JWT binds the public team and app identifiers as well as the canonical project/app IDs; the gateway checks the hostname and path before routing to a trusted installation. Sandboxed apps obtain scoped JWTs through the host bridge and call the backend over authenticated HTTP, with a WebSocket for query subscriptions. Platform credentials remain in the host server.

The installation ID stays the same across public/internal app IDs, scope-list ordering and published deployments.

The runtime derives its issuer from `PLATFORM_URL` and verifies JWTs using `APP_RUNTIME_PUBLIC_KEYS`, a configured public JWKS. No public-key request is made. Audience is fixed to `tailorkit-apps-worker`. Calls allow browser origins and omit cookies; JWT authorization remains mandatory. The worker authenticates and routes requests to the supervisor named `[issuer, projectId, appId, installationId]`. The supervisor verifies authentication again and resolves the currently published bundle from the `DEPLOYMENTS` KV namespace, falling back to the authenticated platform API on a miss. A different app/project is forbidden. Deployment claims do not pin execution: existing client code continues calling the latest published server.

The supervisor reads the exact private R2 key returned by the platform, verifies the stored size and SHA-256, decompresses gzip bundles with a 3 MiB limit on the decoded code, and combines the application module with its own Cloudflare bootstrap. Existing uncompressed bundles remain supported. One dynamic `AppFacet` runs queries, mutations and actions. Its loader key includes the installation, deployment and checksum. The facet receives no platform credentials or bindings. Native networking is disabled with `globalOutbound: null`; a global fetch wrapper allows active actions to use a scoped trusted RPC capability. Verified identity is passed directly over RPC; browser headers are never forwarded to app code.

Each installation uses the fixed facet name `app`. Updating code aborts the old facet and starts the new class with the **same SQLite database**. Deployment IDs never select databases. This is Durable Object SQLite, not D1. One published deployment runs at a time. Existing sockets reconnect to the replacement without remounting client UI. Each new facet synchronously applies the deployment's pending app migrations before accepting database calls; concurrent versions are unsupported.

External database requests and subscriber refreshes share an installation-local queue; actions execute independently and call database handlers directly inside the facet. Each synchronous database handler completes without interleaving. Platform-issued tokens last five minutes. The trusted installation ends subscriptions at token expiry; the app client refreshes authentication through the JWT bridge one minute before expiry and reconnects with fresh query snapshots. WebSockets use oRPC hibernation: the trusted installation persists subscription records, keeps only connection IDs in socket attachments, and uses storage alarms to close expired sessions. Socket lifecycle, durable records and dependency tracking live together in `src/supervisor/subscriptions.ts`; oRPC encoding and delivery remain in `src/transport.ts`.

`src/supervisor/source.ts` reads and authorizes cached published metadata, verifies bundle integrity, and caches code per warm installation. Effect handles execution errors, trusted coordination, serialized database access and scoped action cleanup. The app SDK separates synchronous persistence, asynchronous execution and subscription delivery; neither apps nor browser clients need Effect. The execution implementation is coupled to Cloudflare and remains private; the public app API and oRPC contract stay in the Apache-2.0 SDK.

The runtime has no fixed project or environment scope. `projectId` comes from the verified JWT and remains part of the stable installation identity.

Configure the same private service credential as `RUNTIME_SERVICE_TOKEN` on this worker and `APP_RUNTIME_SERVICE_TOKEN` on the platform server (at least 32 characters). It authorizes **only** the published bundle metadata endpoint; it cannot upload, publish or call other platform APIs. The platform checks the requested app belongs to the project before returning its private R2 key. This credential stays in trusted infrastructure and is never given to app developers or dynamic code.

The platform needs `APP_RUNTIME_SIGNING_KEY`, an ES256 private JWK with a stable `kid`, stored as a server secret. Its `OPENAPI_SERVER_URL` must match the runtime's `PLATFORM_URL` (trailing slash is normalized). Configure matching public key material in this Worker's `APP_RUNTIME_PUBLIC_KEYS` variable, as a JWKS object or JSON string. Replace the empty `keys` placeholder before running against a real platform. For rotation, deploy the new public key to the Worker before changing the platform signing key, retaining the previous public key for at least six minutes. Private keys stay only on the platform.

## Request flow

The host still returns the runtime's `/rpc` base URL. The client selects the route:

| Route            | Transport             | Execution                                                        |
| ---------------- | --------------------- | ---------------------------------------------------------------- |
| `/rpc/queries`   | POST JSON             | SQLite facet, one-off query                                      |
| `/rpc/mutations` | POST JSON             | SQLite facet, committed write and subscription updates           |
| `/rpc/actions`   | POST JSON             | Shared dynamic facet, outbound HTTPS through a scoped capability |
| `/rpc/queries`   | GET WebSocket upgrade | Trusted Durable Object, query subscriptions                      |

The table paths are relative to `/p/<projectId>/a/<appPublicId>`. HTTP requests and responses use the oRPC wire protocol. Procedure inputs contain `{ name, args }`; mutations also require a UUID `requestId`. oRPC preserves typed errors and their HTTP statuses. The URL determines the operation type, so bodies cannot override it. Nested names such as `todos.list` retain their full path. WebSockets expose subscriptions only.

The gateway authenticates and selects the trusted installation Durable Object. The installation verifies the published deployment with Effect, owns WebSockets and subscriptions, and calls the isolated SQLite facet directly over RPC. Each internal RPC call returns `{ result, tables, committed }`, where `result` contains either `{ ok: true, value }` or `{ ok: false, error: { code, message } }`. Values pass schema and JSON serialization validation before mutations commit. Queries report their read dependencies; mutations report changed tables. Errors retain table metadata, but rolled-back and replayed mutations do not invalidate subscriptions. The trusted oRPC transport translates values and errors into the client wire protocol and generates HTTP headers.

Actions call queries and mutations directly in the same execution engine, entering fresh database contexts with the same verified identity. Mutation transactions and receipts stay local. After each committed mutation, the facet reports changed tables to the trusted installation and awaits subscriber refreshes before continuing. Replayed and rolled-back writes do not send notifications. Earlier writes remain committed if the action later fails.

The application builder exports only the app definition and embedded migrations in `server/server.js`. It ships no Cloudflare bootstrap classes. The worker builds its bootstrap independently, installs the ALS-backed fetch guard before importing the app, and initializes SQLite before admitting handlers. Queries and mutations remain synchronous; actions remain asynchronous. Action query/mutation collections are checked and compiled during initialization; callbacks are bound to each invocation. A fresh context is established for every handler, including database calls made by actions. The fetch guard is a DX rule within shared app code, not isolation between malicious handlers.

## Actions

Each action gets one `ActionCapability` for outbound HTTP and committed-table notifications. It exposes no database call bridge, platform credentials, R2 binding, installation namespace or SQLite handle. Actions are cancelled on token expiry, request cancellation, completion or deployment replacement. There are no application action concurrency or database/outbound call-count quotas and no separate 30-second action timeout. Cloudflare CPU and subrequest limits still apply.

The gateway allows public HTTPS endpoints, checks every redirect, and rejects literal private/loopback addresses and local/internal hostnames. It forwards no platform credentials. Cancellation streams cross RPC boundaries because attached AbortSignals cannot be serialized. Actions share module state with queries and mutations; they do not have fresh isolates. Local query/mutation calls remain one-off executions; an action as a whole is not a transaction.

## Code layout

- `@tailorkit/app/protocol`: public oRPC procedures, input/output types and migration inputs, with no server implementation.
- `src/runtime`: private execution, ALS, fetch guard, database transactions, receipts and migration application.
- `src/transport.ts`: private implementation of the public contract, HTTP/WebSocket handlers and event encoding.
- `src/supervisor`: four modules for authentication, deployment loading, action cancellation/egress and subscriptions.
- `src/runtime/cancellation.ts`: cancellation streams shared by the facet and trusted worker.
- `src/dynamic-workers/facet.ts`: Cloudflare bootstrap and SQLite adapter.
- `@tailorkit/api-utils/app-auth`: private JWT helpers shared with the platform backend.

## Local commands

From the repository root:

```sh
pnpm --filter @tailorkit/api-utils build
pnpm --filter @tailorkit/app build
pnpm --filter @tailorkit/apps-worker check-types
pnpm exec turbo run test --filter=@tailorkit/apps-worker
```

`test` dry-builds with Wrangler and runs its bundled Miniflare/workerd locally with disposable persistent R2 and DO state. It substitutes only the trusted platform metadata HTTP response. It verifies JWT/project checks, private R2 downloads, code hashes, isolation, blocked network access, deployment switches, rejection of old tokens, cold restart persistence, token expiry and WebSocket renewal, HTTP queries/mutations/actions, nested function dispatch, oRPC query subscriptions, accepted-write deduplication and realtime updates between two clients using the new `backend-todo` app.

Server artifacts include Drizzle-generated migration SQL and checksums. Facet initialization applies pending migrations and records their history in `tailorkit_migrations`, in the same isolated SQLite database as the app tables. The integration test uses this production bootstrap and verifies upgrades, failed-migration rollback, cold recovery and fresh installations after an upgrade.

To run the gateway against a development platform, copy `.dev.vars.example` to `.dev.vars`, fill in the platform URL and private runtime service token, and set the R2 bucket in `wrangler.jsonc` to the same private bucket used by the platform blob provider.

App bundles are uploaded and published with `tailorkit deploy`. The CLI gzips client and optional server code, obtains private upload URLs from the platform, and uploads the compressed bytes with signed content-encoding and checksum headers. Client assets are served with `Content-Encoding: gzip` when accepted, with decoded delivery otherwise. Before publication, the platform downloads gzip client bundles and rejects decoded code above 3 MiB. Worker and Node delivery also cap decoded streams at 3 MiB. The Node asset adapter serves the decoded stream supplied by Node fetch. When the platform blob provider uses R2, both files go into that R2 bucket. The runtime's `BUNDLES` binding must point to the same bucket.

`wrangler dev --local` uses a separate local R2 store; ordinary TailorKit deployments do not populate it. Use `test` for the complete local runtime demonstration: its test fixtures populate disposable R2 directly, without a seed command.

```sh
pnpm --filter @tailorkit/apps-worker dev
```

Wrangler watches runtime/server changes. App code is rebuilt and uploaded through the existing app builder/CLI, then published through the existing deployment flow. Changing local runtime code does not publish an app deployment.

DO/R2 state lives in `apps/apps-worker/.tailorkit/state`, outside app builder output.

Local compatibility uses the date supported by the repository's pinned workerd. No production deployment is performed by these commands.

No custom request, result, frame or bundle size caps are imposed by this runtime. Bundle content length and checksum are still checked for integrity.

## Current limits

- App migrations are bundled with server deployments and applied lazily per installation. There is no remote migration endpoint or bulk migration command. Applied history is immutable; deployments with changed applied migrations are rejected. Older bundles may contain an exact prefix of applied history without undoing migrations. Database downgrades and adoption of pre-existing unmanaged tables are unsupported. Large migrations and backfills can exceed the facet CPU limit.
- The platform is the only token issuer. Project keys limit hosts to their own projects; hosts remain responsible for authenticating their users and returning verified scopes. The platform authorizes app access against those scopes and derives installation IDs from the authorized app. The platform has no customer-host user membership database.
- Published metadata is read from KV, with platform lookup and cache fill on a miss. A changed KV pointer is confirmed with the platform before replacing a running deployment. Verified code is cached per warm installation and read from R2 again after a cold restart.
- Updates close existing subscription connections; clients reconnect to the latest deployment without remounting the app. Schema compatibility across updates remains the app developer's responsibility.
- Runtime limits constrain CPU and subrequests; quotas, abuse accounting and facet/database lifecycle cleanup are future work. Untrusted apps can break their own schema or invalidation tracking.

Application bundles export a `runtimeManifest` alongside the default application definition and migrations. The SDK builder emits `{ apiVersion: 1, requires: ["database", "actions", "database-relations"] }`. The facet validates the exports, API version and required features before touching SQLite. Unsupported bundles fail with `INCOMPATIBLE_VERSION`. Breaking handler/module changes increment `apiVersion`; additive capabilities can be named in `requires`. Bundles only require a runtime upgrade when their declared interface or required features are unsupported. The shared `ApplicationModule` and `RuntimeManifest` types are exported by `@tailorkit/app/server`.

## Deployment metadata cache

The platform sends `POST https://internal.tailorkit.app/p/<projectId>/a/<appPublicId>/new-deployment` after publication or a rollout. `APP_RUNTIME_INTERNAL_URL` optionally overrides that origin; by default it is `https://internal.<ASSET_DOMAIN>`. Only the reserved internal hostname accepts publication requests. The worker checks that the body project and private bundle path match the URL. The body contains `{ projectId, appId, deploymentId, objectKey, checksum, contentLength }`. Requests use `Authorization: Bearer <APP_RUNTIME_SERVICE_TOKEN>`; configure that same secret as `RUNTIME_SERVICE_TOKEN` on the worker. It is independent of signing keys and never enters app code. Vercel calls the worker over HTTPS and needs no Cloudflare API credentials.

KV entries are keyed by `[projectId, appId]` and expire after five minutes. Misses fetch the authoritative platform metadata and fill KV. Publication failures are logged without undoing publication; expiration lets the cache recover even if its previous value remains. Before replacing a running deployment, the worker confirms a changed KV pointer with the platform to avoid switching backwards on stale replicas. A subscriber refresh resolves its facet once and reuses it for all affected subscriptions.

Publication does not broadcast to every installation. Active clients discover an update on subsequent calls or authentication renewal. KV propagation can delay discovery. The host does not remount the app; server deployments must preserve compatibility with existing client code. Active actions are cancelled on facet replacement and are not automatically retried.

Sandbox iframes always allow HTTP(S) and WebSocket connections. They retain an opaque `null` origin through `sandbox="allow-scripts"`; backend calls omit cookies and require scoped JWTs. Initial rendering does not require a backend session.

## Shared app delivery

One `tailorkit-apps-worker` deployment handles the wildcard `*.tailorkit.app/*` route and the `internal.tailorkit.app` custom domain. The former assets worker/package is retired. Keep the existing worker name and `STORES` binding to preserve installation databases. Configure wildcard proxied DNS for `*.tailorkit.app`; Wrangler provisions the internal custom domain. The platform's `ASSET_DOMAIN` must match this worker's value.

Tenant routes:

- `/p/<projectId>/a/<appPublicId>/d/<deploymentPublicId>/client/client.js`: immutable public client bundle.
- `/p/<projectId>/a/<appPublicId>/d/<deploymentPublicId>/logos/<filename>`: logos. Content-addressed logos use shared R2 storage.
- `/p/<projectId>/a/<appPublicId>/rpc/queries`, `/rpc/mutations`, `/rpc/actions`: HTTP backend calls; query subscriptions use WebSockets on the queries route.

RPC URLs omit the deployment ID and run the latest published backend. Deployment claims never select a separate database or pin execution. Asset responses preserve their edge cache, bounded browser TTL and security headers. RPC responses are not cached. Shared asset admission, size checks and sanitized error responses are Effect programs in `@tailorkit/asset-delivery`; the Cloudflare and Node adapters compose storage, fetch and cache operations with Effect and run them at the request boundary. Cache lookup/write failures do not prevent asset delivery.

The platform needs `APP_RUNTIME_SIGNING_KEY` and `APP_RUNTIME_SERVICE_TOKEN`; no `APP_RUNTIME_URL` is needed for production's default team subdomains. Deploy the combined worker and platform, and delete the standalone `tailorkit-assets` Worker and its Workers Builds integration. Only the new URLs and signed routing claims are supported.
