# App runtime

`tailorkit-apps-runtime` is the trusted Cloudflare entry point for app queries, mutations and subscriptions. App server bundles are uploaded by the existing CLI to the private blob bucket under `server/server.js`; client code remains under `client/client.js`. The public assets worker never serves server bundles.

The host authorizes an installation and signs a short-lived ES256 JWT containing `userId` (JWT `sub`), `projectId`, `appId`, `installationId` and `deploymentId`. Configure the host SDK's `storage.resolveInstallation` to return these **canonical database IDs**, the stable installation ID and this runtime's `/rpc` URL. Resolve deployment access on the host server; sandboxed apps still use the storage bridge and never receive platform credentials.

For each request, the gateway verifies the token's signature, issuer, audience, expiry and required project/deployment claims. It routes to a supervisor named `[issuer, projectId, appId, installationId]`. The supervisor verifies authentication again and asks the authenticated platform API (`POST /apps/{appId}/runtime`, with the signed project ID) for the currently published, verified bundle. A different app/project is forbidden; an old deployment returns `INCOMPATIBLE_VERSION` and requires reloading the app.

The supervisor reads the exact private R2 key returned by the platform, verifies its size and SHA-256, and loads `AppFacet` using Dynamic Workers. Its loader key includes the installation, deployment and checksum. The dynamic code has no platform bindings or credentials and no outbound network access. The supervisor overwrites the identity header and removes the JWT.

Each installation uses the fixed facet name `app`. Updating code aborts the old facet and starts the new class with the **same SQLite database**. Deployment IDs never select databases. This is Durable Object SQLite, not D1. One published deployment runs at a time; concurrent versions and automatic schema upgrades are deferred.

Request admission is serialized through an installation-local queue, including publication lookup, but streaming responses release that queue immediately. The supervisor ends subscriptions at token expiry; the existing host client refreshes authentication and reconnects with a fresh query snapshot.

`DeploymentSource` and `FacetExecution` are private Effect v4 services. Shared app query/mutation execution already receives separate persistence and notification services; neither apps nor browser clients need Effect. Provider services can be substituted in tests or a future self-hosted implementation without changing the app API.

The runtime has no fixed project or environment scope. `projectId` comes from the verified JWT and remains part of the stable installation identity.

Configure the same private service credential as `RUNTIME_SERVICE_TOKEN` on this worker and `APP_RUNTIME_SERVICE_TOKEN` on the platform server (at least 32 characters). It authorizes **only** the published bundle metadata endpoint; it cannot upload, publish or call other platform APIs. The platform checks the requested app belongs to the project before returning its private R2 key. This credential stays in trusted infrastructure and is never given to app developers or dynamic code.

## Code layout

- `src/index.ts`: Wrangler entry point, gateway and installation supervisor.
- `src/source.ts`: private deployment metadata and R2 bundle retrieval.
- `src/runtime.ts`: service contracts, request orchestration and installation routing.
- `src/worker-env.d.ts`: Wrangler-generated bindings and runtime types; code uses `Env` directly.
- `src/http.ts`: bounded bodies, error responses and authenticated streams.

Tests live beside the code they exercise. Unit tests cover gateway routing, authentication, deployment changes, code caching, isolation settings, source validation, request queues and stream lifecycle. The local workerd demonstration checks the real Cloudflare bindings and two-client realtime behavior.

## Local commands

From the repository root:

```sh
pnpm --filter @tailorkit/app-storage build
pnpm --filter @tailorkit/apps-runtime check-types
pnpm --filter @tailorkit/apps-runtime verify
```

`verify` dry-builds with Wrangler and runs its bundled Miniflare/workerd locally with disposable persistent R2 and DO state. It substitutes only the trusted platform metadata HTTP response. It verifies JWT/project checks, private R2 downloads, code hashes, isolation, blocked network access, deployment switches, rejection of old tokens, cold restart persistence, token expiry, oRPC v2 queries/mutations, accepted-write deduplication and realtime updates between two clients.

The todo test fixture initializes its disposable database using the existing Drizzle-generated migration; **production uploads contain no migrations**.

To run the gateway against a development platform, copy `.dev.vars.example` to `.dev.vars`, fill in trusted keys and the private runtime service token, and set the R2 bucket in `wrangler.jsonc` to the same private bucket used by the platform blob provider.

App bundles are uploaded and published with `tailorkit deploy`. The CLI obtains private upload URLs from the platform and uploads both client and optional server code. When the platform blob provider uses R2, both files go into that R2 bucket. The runtime's `BUNDLES` binding must point to the same bucket.

`wrangler dev --local` uses a separate local R2 store; ordinary TailorKit deployments do not populate it. Use `verify` for the complete local runtime demonstration: its test fixtures populate disposable R2 directly, without a seed command.

```sh
pnpm --filter @tailorkit/apps-runtime dev
```

Wrangler watches runtime/server changes. App code is rebuilt and uploaded through the existing app builder/CLI, then published through the existing deployment flow. Changing local runtime code does not publish an app deployment.

DO/R2 state lives in `apps/apps-runtime/.tailorkit/state`, outside app builder output.

Local compatibility uses the date supported by the repository's pinned workerd. No production deployment is performed by these commands.

## Current limits

- Remote migration distribution and authorization remain intentionally undecided. A fresh uploaded SDK app returns a migration-required error until a schema initialization path is provided. This worker has no remote migration endpoint and stores no migration artifacts. Local migration tooling remains in `apps-cloud`.
- The runtime accepts any project authorized by its configured trusted host issuer/signing keys. The host must authorize project/app/installation membership before issuing a JWT and select the deployment actually loaded by the client. Independent host issuers/key registries remain future work.
- Published metadata is checked on every request. Platform metadata must be available; verified code is cached per warm installation and read from R2 again after a cold restart.
- Updates stop existing subscriptions; clients reload for a deployment change. Schema compatibility across updates remains the app developer's responsibility.
- Runtime limits constrain CPU and subrequests; quotas, abuse accounting and facet/database lifecycle cleanup are future work. Untrusted apps can break their own schema or invalidation tracking.
- The old `apps-cloud` supervisor remains for the existing local app tooling. New hosted runtime requests should target this worker.
