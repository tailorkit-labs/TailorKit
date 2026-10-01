# App runtime

`tailorkit-apps-runtime` is the trusted Cloudflare entry point for app queries, mutations, actions and subscriptions. App server bundles are uploaded by the existing CLI to the private blob bucket under `server/server.js`; client code remains under `client/client.js`. The public assets worker never serves server bundles.

The host authorizes an installation and calls the platform API using its existing project key. The platform checks the app belongs to that project and the supplied verified scopes, resolves its published deployment, and issues a short-lived ES256 JWT containing `userId` (JWT `sub`), `projectId`, `appId`, `installationId` and `deploymentId`. Configure the host SDK's `backend.resolveInstallation` to return these **canonical database IDs**, the stable installation ID and this runtime's `/rpc` URL. The host SDK calls `POST /apps/{appId}/runtime/session`; customer hosts never receive signing keys. Resolve deployment access on the host server; sandboxed apps obtain scoped JWTs through the bridge and call the backend directly over a WebSocket. Platform credentials remain in the host server.

The runtime derives its issuer from `PLATFORM_URL`, fetches trusted public keys from `GET /runtime/keys`, and caches them for 60 seconds. Audience is fixed to `tailorkit-apps-runtime`. Calls allow any browser origin and omit cookies; JWT authorization remains mandatory. For each request, the gateway verifies the token's signature, issuer, audience, expiry and required project/deployment claims. It routes to a supervisor named `[issuer, projectId, appId, installationId]`. The supervisor verifies authentication again and asks the authenticated platform API (`POST /apps/{appId}/runtime`, with the signed project ID) for the currently published, verified bundle. A different app/project is forbidden; an old deployment returns `INCOMPATIBLE_VERSION` and requires reloading the app.

The supervisor reads the exact private R2 key returned by the platform, verifies its size and SHA-256, and loads `AppFacet` using Dynamic Workers. Its loader key includes the installation, deployment and checksum. The database facet has no platform bindings or credentials and no outbound network access. Actions use a separate stateless worker with scoped callbacks and a trusted HTTPS egress gateway. The supervisor overwrites the identity header and removes the JWT.

Each installation uses the fixed facet name `app`. Updating code aborts the old facet and starts the new class with the **same SQLite database**. Deployment IDs never select databases. This is Durable Object SQLite, not D1. One published deployment runs at a time; concurrent versions and automatic schema upgrades are deferred.

Request admission is serialized through an installation-local queue, including publication lookup, but streaming responses release that queue immediately. The supervisor ends subscriptions at token expiry; the apps-server client refreshes authentication through the JWT bridge and reconnects with fresh query snapshots. Standard WebSockets keep the supervisor awake; hibernation is deferred.

`DeploymentSource`, `FacetExecution` and `ActionExecution` are private Effect v4 services. The new apps-server SDK separates synchronous persistence, asynchronous execution and subscription delivery; neither apps nor browser clients need Effect. Provider services can be substituted in tests or a future self-hosted implementation without changing the app API.

The runtime has no fixed project or environment scope. `projectId` comes from the verified JWT and remains part of the stable installation identity.

Configure the same private service credential as `RUNTIME_SERVICE_TOKEN` on this worker and `APP_RUNTIME_SERVICE_TOKEN` on the platform server (at least 32 characters). It authorizes **only** the published bundle metadata endpoint; it cannot upload, publish or call other platform APIs. The platform checks the requested app belongs to the project before returning its private R2 key. This credential stays in trusted infrastructure and is never given to app developers or dynamic code.

The platform needs `APP_RUNTIME_SIGNING_KEY`, an ES256 private JWK with a stable `kid`, stored as a server secret. Its `OPENAPI_SERVER_URL` must match the runtime's `PLATFORM_URL` (trailing slash is normalized). Only public key material is returned by `/runtime/keys`. For rotation, optionally configure `APP_RUNTIME_PREVIOUS_PUBLIC_KEYS` as a public JWKS and retain retired keys for at least six minutes. A token with a newly rotated key may be rejected until the 60-second cache refreshes.

## Actions

The same uploaded server artifact exports a SQLite `AppFacet` and a stateless default action entry point. The WebSocket action route verifies the published deployment and runs the action outside the database/realtime queues. It creates a fresh Dynamic Worker with only an installation-bound `DATABASE` callback binding and an HTTPS outbound gateway. Queries and mutations still use `globalOutbound: null` and zero subrequests.

The callback capability fixes the verified user, project, app, installation and deployment. Actions use typed `ctx.queries.<name>(args)` and `ctx.mutations.<name>(args)` calls. Every database call returns through the installation's normal realtime coordinator, including table invalidation. Capabilities are revoked after completion/cancellation/expiry and checked again when queued database work starts. No JWT, platform service credential, R2 binding or SQLite handle enters the action worker.

Actions have a 30-second deadline capped by JWT expiry, 50 ms CPU, 64 database/outbound calls, and a per-installation limit of 16 concurrent actions. The gateway allows HTTPS, checks each redirect, rejects literal private/loopback destinations and local/internal hostnames, and never injects platform credentials. There is no durable action scheduling or automatic retry. An action failure cannot roll back earlier committed mutations or external effects.

## Code layout

- `src/index.ts`: Wrangler entry point, gateway and installation supervisor.
- `src/facet.ts`: SQLite execution adapter, compiled into each isolated app artifact.
- `src/action-worker.ts`: stateless action entry point compiled into the same app artifact.
- `src/actions.ts`: scoped action capabilities, deadlines and HTTPS egress gateway.
- `src/source.ts`: private deployment metadata and R2 bundle retrieval.
- `src/runtime.ts`: service contracts, request orchestration and installation routing.
- `src/worker-env.d.ts`: Wrangler-generated bindings and runtime types; code uses `Env` directly.
- `src/http.ts`: bounded bodies, error responses and authenticated streams.

Tests live beside the code they exercise. `src/integration.test.mjs` runs against real local workerd/R2 bindings as part of the normal test command. Unit tests cover gateway routing, authentication, deployment changes, code caching, isolation settings, source validation, request queues and stream lifecycle. The local workerd demonstration checks the real Cloudflare bindings and two-client realtime behavior.

## Local commands

From the repository root:

```sh
pnpm --filter @tailorkit/apps-server build
pnpm --filter @tailorkit/apps-runtime check-types
pnpm --filter @tailorkit/apps-runtime test
```

`test` dry-builds with Wrangler and runs its bundled Miniflare/workerd locally with disposable persistent R2 and DO state. It substitutes only the trusted platform metadata HTTP response. It verifies JWT/project checks, private R2 downloads, code hashes, isolation, blocked network access, deployment switches, rejection of old tokens, cold restart persistence, token expiry and WebSocket renewal, oRPC v2 queries/mutations/actions, accepted-write deduplication and realtime updates between two clients using the new `backend-todo` app.

The todo test fixture initializes its disposable database using the existing Drizzle-generated migration; **production uploads contain no migrations**.

To run the gateway against a development platform, copy `.dev.vars.example` to `.dev.vars`, fill in the platform URL and private runtime service token, and set the R2 bucket in `wrangler.jsonc` to the same private bucket used by the platform blob provider.

App bundles are uploaded and published with `tailorkit deploy`. The CLI obtains private upload URLs from the platform and uploads both client and optional server code. When the platform blob provider uses R2, both files go into that R2 bucket. The runtime's `BUNDLES` binding must point to the same bucket.

`wrangler dev --local` uses a separate local R2 store; ordinary TailorKit deployments do not populate it. Use `test` for the complete local runtime demonstration: its test fixtures populate disposable R2 directly, without a seed command.

```sh
pnpm --filter @tailorkit/apps-runtime dev
```

Wrangler watches runtime/server changes. App code is rebuilt and uploaded through the existing app builder/CLI, then published through the existing deployment flow. Changing local runtime code does not publish an app deployment.

DO/R2 state lives in `apps/apps-runtime/.tailorkit/state`, outside app builder output.

Local compatibility uses the date supported by the repository's pinned workerd. No production deployment is performed by these commands.

## Current limits

- Remote migration distribution and authorization remain intentionally undecided. Fresh app tables need initialization before queries work; schema initialization is not performed automatically. This worker has no remote migration endpoint and stores no migration artifacts.
- The platform is the only token issuer. Project keys limit hosts to their own projects; hosts remain responsible for authenticating their users and asserting authorized installation IDs and scopes. The platform has no customer-host user membership database.
- Published metadata is checked on every request. Platform metadata must be available; verified code is cached per warm installation and read from R2 again after a cold restart.
- Updates stop existing subscriptions; clients reload for a deployment change. Schema compatibility across updates remains the app developer's responsibility.
- Runtime limits constrain CPU and subrequests; quotas, abuse accounting and facet/database lifecycle cleanup are future work. Untrusted apps can break their own schema or invalidation tracking.
