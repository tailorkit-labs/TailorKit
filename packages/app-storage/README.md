# App storage

TailorKit apps define typed schemas and synchronous server queries/mutations. The host SDK makes authenticated oRPC v2 calls and renews SSE subscriptions; sandboxed clients use the existing iframe bridge. App developers use neither Drizzle nor oRPC directly.

See the [persistent todo tutorial](../../examples/apps/persistent-todo/README.md) for a runnable two-client app.

## Define server functions

```ts
import { createFunctions, defineSchema, defineStore, fields } from "@tailorkit/app-storage/server";
import { z } from "zod";

const schema = defineSchema({
  notes: { id: fields.text({ primaryKey: true }), text: fields.text() },
});
const { query, mutation } = createFunctions(schema);
const note = z.object({ id: z.string(), text: z.string() });

export default defineStore({
  schema,
  apiVersion: 1,
  functions: {
    list: query({
      input: z.object({}),
      output: z.array(note),
      handler: ({ db }) => db.table("notes").all(),
    }),
    add: mutation({
      input: z.object({ text: z.string().min(1) }),
      output: note,
      handler: ({ db }, input) =>
        db.table("notes").insert({ id: crypto.randomUUID(), text: input.text }),
    }),
  },
});
```

Input and output validators implement Standard Schema. Both validators and handlers must complete synchronously. A mutation executes in one synchronous SQLite transaction, including its deduplication receipt. Returning a Promise rejects and rolls back the mutation. Async orchestration happens outside this transaction.

Tables expose `all({ where, orderBy, limit })`, `first(where)`, `insert(row)`, `update(where, values)`, and `delete(where)`. Filters match fields by equality; update/delete require a nonempty filter. Supported fields are text, integer, number and boolean, with nullable, primary-key and unique options. Each table needs one primary key.

## Use generated references

The CLI generates `src/storage.gen.ts`. Its server import is type-only, so handlers and validators do not enter browser bundles.

```ts
import { createAppStorageClient } from "@tailorkit/app-storage";
import { api } from "./storage.gen";

const storage = createAppStorageClient();
const stop = storage.subscribe(api.list, {}, (notes) => renderNotes(notes));
await storage.mutate(api.add, { text: "Hello" });
stop();
```

`query(reference, input)` returns a value. `mutate(reference, input, { requestId })` accepts an optional UUID. Reuse that UUID when retrying an ambiguous write; reusing it with different input fails. Receipts persist with the installation data. Host token retries preserve the request ID.

Subscriptions take optional `onError` and `onStatus` callbacks. They renew authentication and reconnect with a fresh snapshot. Successful mutations invalidate queries whose read tables intersect changed tables; each rerun replaces its dependencies. Delivery coalesces intermediate results to the latest snapshot.

## Authentication and execution

Configure `storage` on `createTailorKitServer` with an ES256 signing key, issuer, audience and `resolveInstallation`. That callback must authorize app membership using the host's authenticated scopes, and return a stable user ID, app ID, installation ID and runtime URL. The SDK sends only the app ID to the session endpoint. The iframe receives no token, signing key or runtime URL.

The trusted runtime verifies the signature, issuer, audience, expiry and app access, then derives the supervisor DO ID from `[issuer, appId, installationId]`. The supervisor verifies access again, strips the JWT, overwrites identity metadata and forwards to a facet. Subscription streams expire at the trusted boundary even if app code ignores its own runtime checks.

Each installation has a separate Dynamic Worker isolate and SQLite facet. Loader cache keys include the installation and code hash, so module globals cannot communicate across installations. Dynamic code has empty bindings and `globalOutbound: null`; it cannot access the supervisor database, platform Postgres/blob storage, other installation namespaces or the network. The app owns its facet data: deliberately hostile code may bypass its own wrappers, receipts or invalidation tracking, which breaks that app's guarantees.

The trusted supervisor never imports app implementations. Build-time schema inspection also runs in a network-disabled Dynamic Worker inside a disposable workerd process with a hard timeout. Bundle compilation uses the CLI's trusted Vite configuration. Local project configuration is trusted operator input; uploaded projects also require an isolated build job. Uploaded code must continue through this path rather than being imported into a platform Node process.

## Migrations

```sh
tailorkit storage generate --name initial
tailorkit build
tailorkit storage dev
# In a second terminal, prepare a specific installation:
tailorkit storage migrate --installation demo
```

`generate` creates a private Drizzle model and invokes the pinned Drizzle CLI. Commit the generated SQL, snapshots, schema fingerprint and client references. Builds reject schema changes without generated migrations. `migrate` applies the bundled history atomically in the selected facet and records hashes; normal queries never run pending migrations.

Facet SQLite is not D1. The CLI calls `/_tailorkit/migrate` on the trusted runtime rather than accessing a D1 binding. The supervisor checks a separate migration JWT and the exact code/migration manifest. It accepts no arbitrary SQL in the request. Local commands sign a short-lived operator token using ignored development keys. For a remote runtime:

```sh
tailorkit storage migrate --installation installation-id \
  --url https://storage.example.com --token-file /secure/migration.jwt
```

An authorized operator issues this token through `issueStorageMigrationToken`; use its installation/app identity, a lifetime of at most five minutes, the host issuer and the migration audience (`normal-audience:migrations`). The ordinary host session endpoint cannot issue migration tokens. The CLI checks the selected installation matches the token; the supervisor verifies the signature and access. Operator token issuance and installation enumeration remain responsibilities of the host/platform.

Keep supervisor namespace names and facet name `app` stable across deployments. Code hashes change without changing storage IDs. A supervisor aborts the old facet on code changes; reconnecting clients obtain fresh results. Existing installations must be migrated explicitly after a schema update. Bump `apiVersion` for breaking API changes. Edited migration histories, older schemas, older database API versions and mismatched clients fail explicitly. This first version does not coordinate rolling deployments of incompatible schemas.

## Replace provider services

Server integration uses private Effect v4 services and Layers:

| Service                | Responsibility                                    |
| ---------------------- | ------------------------------------------------- |
| `Authentication`       | Verify invocation or migration access             |
| `InstallationRouting`  | Route the verified identity to isolated execution |
| `Persistence`          | Synchronous SQL execution and atomic transaction  |
| `NotificationDelivery` | Ordered invalidation publication and listeners    |
| `Execution`            | Shared query/mutation/subscription runtime        |
| `StorageTools`         | Inspect, build and start the configured adapter   |

Tests replace services using `Layer.succeed` or `Effect.provideService`. Apps and browser code need no Effect imports. Persistence and notification delivery have independent boundaries. The initial delivery adapter is local to a facet; a future Redis/Upstash service needs durable publication/revision reconciliation and must preserve registration ordering. No remote adapter is implemented here.

## Cloudflare runtime and limits

All Cloudflare-specific code and dependencies live in `apps/apps-cloud`: Worker/supervisor classes, facets, generated bindings, isolated build inspection, Wrangler configuration generation and local startup. The shared builder and CLI call the configured `StorageTools` Layer. The example uses `storage.adapter: "@tailorkit/apps-cloud/tooling"` and a stable `storage.namespace`. Wrangler bundles the trusted Worker entry directly; the builder bundles only the isolated app facet and generates type-only client references and compatibility metadata. Existing client-only apps require no adapter or storage configuration.

Self-hosted execution is deferred. Persistence, notification delivery, execution, authentication/routing and build/development tools remain separate service contracts so another runtime can be added without changing app APIs. Workerd is used only by the Cloudflare local development/build tools.

Initial limits: no joins/index definitions, row tracking, optimistic updates, offline sync, receipt pruning or subscription hibernation. Platform provisioning, rate limits/quotas and automatic installation migration orchestration remain future work. CLI preview starts local storage; remotely shared previews still need a reachable runtime and matching trusted host configuration. Nothing is deployed automatically.

### Server uploads

Deployments store browser code under `client/client.js` and optional server code under `server/server.js` in the private platform blob bucket. Public asset routes only read client assets and logos. The Cloudflare supervisor resolves published code through an authenticated platform API and verifies its checksum before loading it; no app artifact is bundled into the production Worker. A private Effect `ArtifactSource` service keeps retrieval replaceable.

Uploaded server bundles exclude all migration histories. Remote migrations are deferred, so remote installation schema initialization remains pending the migration design. Local Wrangler uses a separate development entry and retains existing local migration commands. See [runtime configuration](../../apps/apps-cloud/README.md).
