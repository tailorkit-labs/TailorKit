# @tailorkit/app

Apache-2.0 app SDK. The implementation lives here; `tailorkit/client` reexports the browser API and `tailorkit/server` reexports backend definitions. The package root also exports `defineServer`. Define SQLite tables, synchronous queries/mutations and async actions with Zod arguments. Drizzle and oRPC v2 run underneath; app code uses this package's APIs.

```ts
import { defineServer, table, text, tk } from "tailorkit/server";
import { z } from "zod";

const notes = table("notes", { id: text().primaryKey(), title: text().notNull() });
const functions = {
  list: tk.query.handler(({ db }) => db.select().from(notes).all()),
  add: tk.mutation
    .input(z.object({ title: z.string().min(1) }))
    .handler(({ db, input }) =>
      db.insert(notes).values({ id: crypto.randomUUID(), title: input.title }).returning().all(),
    ),
};
export default defineServer(functions);
```

Use `tk.query`, `tk.mutation` and `tk.action` with `.handler(fn)`. Both `.input(schema)` and `.output(schema)` are optional and can be chained in either order. Without `.input()`, handler `input` is `undefined` and callers omit the input; supplying a value is rejected. Without `.output()`, return values are allowed and their types are inferred from the handler, including awaited action results. There is no default output schema. When supplied, `.output()` constrains handler returns in TypeScript and validates them at runtime; nonconforming results throw `Invalid function result`. Output transformations determine the types returned to clients and action callbacks. Builders are immutable. The original object-form `query`, `mutation` and `action` helpers remain supported.

Chained handlers receive validated `input`, `db`, and verified `identity` (`userId`, `projectId`, `appId`, `installationId`, `deploymentId`, `expiresAt`). Queries expose selection builders; mutations additionally expose insert/update/delete. Use synchronous `.all()`, `.get()` and `.run()`. Async query/mutation handlers are rejected: writes, output validation and the accepted-write receipt commit in one synchronous transaction. `.output(schema)` validates the output before commit. Throw `AppError` for an intentional public error; unexpected errors are hidden.

Schema exports include `table`, `text`, `integer`, `real`, `boolean` and common comparison/order operators. This is a small supported surface. Apps can import Drizzle for advanced configurations, but those features are not guaranteed to work with tracking or this driver.

## Queries, mutations and actions

| Type     | Database access                         | External calls | Automatic query reruns                      |
| -------- | --------------------------------------- | -------------- | ------------------------------------------- |
| Query    | Read only                               | Blocked        | When subscribed                             |
| Mutation | Read/write in one atomic transaction    | Blocked        | Invalidates affected queries after commit   |
| Action   | Through `ctx.queries` / `ctx.mutations` | Async HTTPS    | One-off calls; no subscription invalidation |

Use `tk.action` for external API calls. Action handlers receive validated `input`, verified `identity`, an abort `signal`, and typed `ctx.queries.<name>(args)` / `ctx.mutations.<name>(args)` methods. They have no `db` handle. Actions can be synchronous or async; query/mutation handlers remain synchronous.

Pass a shared query/mutation collection to `.functions(functions)`, and register that same collection under the same names in `defineServer`. The namespaces expose only the declared queries and mutations; their argument and result types are inferred from the definitions. No generated client references are needed on the server. Actions with no database calls can omit `.functions()`.

To extend the example above, add this action and include it in the app:

```ts
const importNote = tk.action
  .functions(functions)
  .input(z.object({ url: z.url() }))
  .handler(async (ctx) => {
    await ctx.queries.list();
    const response = await fetch(ctx.input.url, { signal: ctx.signal });
    const data = z.object({ title: z.string() }).parse(await response.json());
    return ctx.mutations.add({ title: data.title });
  });
export default defineServer({ ...functions, importNote });
```

Clients call `await client.action(api.importNote, { url })`. Actions are one-shot calls, never subscriptions, and are not automatically retried. Every query/mutation call executes separately; the action as a whole is not a transaction. An earlier mutation stays committed if later external work or result validation fails. Combine related database writes into one mutation when they must be atomic. External writes need the provider's idempotency mechanism before retrying an action. Mutation methods accept an optional second argument `{ requestId }`, for example `ctx.mutations.add({ title }, { requestId })`, to reuse the normal mutation receipt when explicitly retrying a database step.

Cloudflare runs queries, mutations and actions in one dynamic SQLite facet. The server runtime installs an ALS-backed global fetch guard before importing app modules. Ordinary fetch works in actions, including SDKs that capture fetch at import time; queries and mutations reject it. This is a DX guard, not a security boundary between handlers. Actions call queries and mutations directly in the same facet, with fresh database contexts and no application call-count limit. A scoped RPC capability handles outbound HTTP and reports committed tables to refresh subscriptions before the action continues. Platform credentials remain trusted, native networking stays disabled, and external I/O does not hold the database queue. Actions share module state with other handlers.

Cloudflare CPU and subrequest limits still apply (10 ms CPU and 64 worker subrequests). Local database calls do not consume RPC subrequests. There are no application concurrency or call-count quotas or separate action timeout; token expiry bounds action lifetime. The SDK stops its database methods after completion or cancellation, and database execution checks token expiry. Publication is checked when admitting external calls; deployment replacement cancels active actions. Already committed writes and accepted external effects remain committed. Actions are not durable jobs. Nested action calls, scheduling, internal-only functions and app-secret management are deferred.

## Source layout

App projects keep UI views in `src/views/`, backend implementations in `src/functions/`, and database tables in `src/schema.ts`. `src/server.ts` imports functions and registers them with `defineServer`; `src/client.ts` registers views and configures the root provider. `tailorkit init` generates this layout, a sample query, and the provider setup. With the umbrella package, import backend definitions from `tailorkit/server` and Preact hooks from `tailorkit/client`.

Export the function type from `src/server.ts`:

```ts
const app = defineServer({ ...functions, importNote });
export default app;
```

The shared `#tailorkit` module exposes a browser API inferred from that type:

```ts
import { createApi } from "tailorkit/client";
import type app from "./server";

export const api = createApi<typeof app.functions>();
```

Views import `api` from `#tailorkit`. Adding functions or changing their input/output schemas updates types immediately through the type-only import: no backend type generation or build is needed. `createApi` creates references by function name without importing or evaluating server implementations. Init sets up this link. Host schema generation includes it when the configured server entry exists (default `src/server.ts`), including default detection with no server configuration. It resolves the import relative to the generated file, including custom output paths. Missing server files omit the backend API export. Enable backend builds with `server: {}` in config. Client and server entry points default to `src/client.ts` and `src/server.ts`. Configure `client.entry` and `server.entry` in `tailorkit.config.ts` to change them; paths are relative to that config file. API type generation and browser import protection follow the configured server entry. CLI entry overrides are unsupported.

The SDK itself uses these directories:

- `src/database/`: SQLite schema builders, database types and the tracked Drizzle driver.
- `src/server/`: query/mutation/action definitions, atomic database execution, async action execution, realtime coordination and server RPC transport. Tests live beside the implementation.
- `src/client/`: browser WebSocket connection, typed references and session fetching/caching in `session.ts`.
- `src/auth/`: shared token policy, signing/verification, public-key validation and trusted platform key fetching/caching. Change token lifetime and renewal timing in `policy.ts`.

The root `index.ts`, `client.ts`, `server.ts` and `protocol.ts` files expose the public entry points. `views.ts` implements remote views and `preact.ts` implements the provider and hooks. `errors.ts` is shared by the client and server. Private execution and Cloudflare hosting live in `apps/apps-worker`; JWT helpers live in the private `@tailorkit/api-utils/app-auth` module.

Auth signing and verification use Effect v4. `issueAppTokenEffect`, `appTokenVerifierEffect` and `createAppRuntimeVerifierEffect` compose with `Effect.gen`; their Promise counterparts run those programs at the caller boundary. The runtime verifier takes configured public JWKS via `publicKeys` and never fetches signing keys. The Cloudflare adapter supplies its `APP_RUNTIME_PUBLIC_KEYS` variable. Signing and verification share Effect's clock, including JWT expiry checks.

## Build and upload

Add `server: {}` to `tailorkit.config.ts` to build the backend from `src/server.ts`. The client builds from `src/client.ts` by default. `client.entry` and `server.entry` override these source entry points while output filenames stay the same. `tailorkit build` emits `.tailorkit/client/client.js` and `.tailorkit/server/server.js`, and copies committed Drizzle migration files into `.tailorkit/migrations/`. Intermediate server entries are created under the output root’s `tmp/` directory and removed after builds or when the watcher closes; `server/` contains the upload artifact. The server exports the application definition and embedded migrations; Cloudflare bootstrap code belongs to the runtime worker. The builder writes no backend reference source files. The browser builder rejects server implementation imports. `build.outDir` and `--out-dir` change the common output root for all artifacts; preview serves only its `client/` directory.

`tailorkit deploy` uploads the client and private server artifact through existing platform-issued blob upload URLs. Apps need no Cloudflare credentials. R2 stores them under separate `client/` and `server/` prefixes; only client assets are public. Client-only apps continue to build without a server artifact. Watch mode watches both builds.

The legacy `app-storage` SDK, `storage` config and storage CLI commands have been removed. Use `server` config and this SDK. The host session endpoint `/backend/session` uses the existing host `authenticate` callback. The platform verifies scope access and resolves the installation and runtime URL automatically; no extra host backend configuration is required.

## Preact hooks

Configure the provider once in `src/client.ts`:

```ts
import { ClientProvider, defineClient } from "tailorkit/client";
import defaultView from "./views/default";

export default defineClient({
  component: ClientProvider,
  slots: { panel: { "/": defaultView } },
});
```

Views use `useQuery(api.list)`, `useMutation(api.add)` and `useAction(api.importNote)` from `tailorkit/client`. Queries return `data`, `error`, `status`, `isLoading`, `isPending`, `isSuccess` and `isError`. TanStack Store manages query and call state, with selectors keeping unrelated query updates from rerendering other observers. Matching active queries share one live subscription; inline input objects do not cause resubscription when their values are unchanged. Changing inputs clears stale data, fresh snapshots clear subscription errors, and unmounting the last consumer unsubscribes. `{ enabled: false }` as the third argument disables a query.

Mutations expose `mutate(input)` and `mutateAsync(input)`; actions expose `execute(input)` and `executeAsync(input)`. Both expose `data`, `error`, `status`, `isPending`, `isSuccess`, `isError` and `reset()`, and accept `{ onSuccess, onError }` callbacks. Calls start only when invoked. The latest invocation determines the displayed state, and late responses cannot overwrite a newer invocation or a reset. Fire-and-forget methods capture errors in hook state; async methods additionally reject for caller-controlled workflows. Mutations automatically retry connection failures and temporary backend unavailability with exponential backoff from one second up to thirty seconds, retaining their request ID and original arguments. They stay pending during retries and stop when the client closes or a permanent error occurs. Rejected authentication triggers one session refresh before failing. Actions are never automatically retried.

`ClientProvider` creates and closes its client automatically. A custom wrapper can pass a caller-owned `client` and/or a global `onError` callback; caller-owned clients remain open when the provider unmounts. The root `component` stays mounted when the host switches views and unmounts when the app root is cleared. No manual client creation, subscriptions or effect cleanup is needed in views.

## Imperative client

```ts
import { createClient } from "tailorkit/client";
import { api } from "#tailorkit";

const client = createClient();
const stop = client.subscribe(api.list, undefined, (notes) => render(notes));
await client.mutate(api.add, { title: "Shared with every active client" });
stop(); // Abort this query stream and unregister its subscription.
client.close(); // Close the client's connection when it is no longer needed.
```

Shared oRPC fetch procedures carry one-off calls; an oRPC WebSocket carries full query snapshots. The SDK derives its client types from the public oRPC contract in `@tailorkit/app/protocol`. Iterator cancellation unregisters subscriptions. The sandbox bridge supplies scoped JWTs only; backend traffic connects directly to the host-authorized runtime origin. Platform-issued tokens last five minutes. The host SDK caches sessions until one minute before expiry. The socket reconnects one minute before expiry, resubscribes active queries and receives fresh snapshots. No subscription pings or per-query expiry leases are required. A broken connection drops server subscriptions; reconnect creates new subscriptions. Inactive/unsubscribed queries receive no updates.

Automatic mutation retries reuse the original UUID. The atomic receipt returns the original result without writing or invalidating again. For explicit retries across separate `client.mutate` calls, retain a UUID and pass `{ requestId }` to each call. Reusing that UUID with different arguments or identity is rejected. Retry delays can be configured through `createClient({ retryDelayMs })`; query subscriptions use this delay too.

## Reactivity and provider boundary

The Drizzle driver records tables read by each query, including empty selections and joins, and tables changed by successful writes. Only committed writes invalidate. The supervisor reruns affected active queries as their original verified users and replaces each dependency set. Initial subscription registration and mutations share a queue, avoiding an initial-snapshot race. Slow consumers retain the latest complete pending snapshot.

The host provides the `/rpc` base URL. `client.query`, `client.mutate` and `client.action` POST to `/rpc/queries`, `/rpc/mutations` and `/rpc/actions` respectively, with the session JWT in the Authorization header. `client.subscribe` opens `/rpc/queries` as a WebSocket and reconnects before token expiry. The trusted installation Durable Object owns subscriptions and invalidates them after both client and action mutations. The isolated SQLite facet returns a serializable response, touched tables and commit status over direct RPC, including table metadata on errors. Rebuild existing clients alongside server bundles when adopting these routes.

Nested groups are supported in `defineServer({ todos: { list, add }, tasks: { importTodos } })` and inferred by `createApi<typeof app.functions>()`. Calls such as `client.query(api.todos.list)` preserve the wire name `todos.list`. An action declaring `.functions({ todos: { list, add } })` receives `ctx.queries.todos.list()` and `ctx.mutations.todos.add(...)`.

`@tailorkit/app/protocol` defines the public oRPC contract and application migration input types. The private BUSL-1.1 worker in `apps/apps-worker` owns execution, ALS and the fetch guard, database transactions and receipts, authentication, subscriptions and Cloudflare hosting. The public Apache-2.0 SDK contains app definitions, schema helpers, clients, hooks and build tooling. App authors and browser clients do not need Effect.

## Local validation and current limits

```sh
pnpm --filter @tailorkit/app build
pnpm --filter tailorkit build
pnpm --filter backend-todo build
pnpm --filter @tailorkit/app test
pnpm --filter @tailorkit/apps-worker test
```

The runtime test runs disposable local Wrangler/workerd/R2 state and two clients against the example's real backend, including an external API action and writes continuing while it waits. It checks persistent writes, atomic replay protection, realtime snapshots, JWT renewal and recovery after restart. It needs no Cloudflare account and deploys nothing. See `examples/apps/backend-todo` and the runtime README.

## Database migrations

Generate app migrations with Drizzle Kit v1 and commit the generated files. `table()` defines a Drizzle-compatible schema; schema changes take effect through these migrations.

```sh
pnpm db:generate
# Or run directly, with an optional migration name:
pnpm exec tailorkit db generate --name add_notes
```

Run `pnpm db:generate` after changing `src/schema.ts`, review and commit the generated migrations, then build and deploy normally. Init and the todo examples include matching Drizzle v1 development dependencies and this script. No `drizzle.config.ts` is needed: generation uses SQLite, `src/schema.ts`, and root `migrations/` by default. `tailorkit.config.ts` is the only framework config; `server.migrations` changes the directory for both generation and builds. No database connection is needed to generate migrations. Drizzle handles generation and rename prompts; TailorKit supplies the paths.

The builder reads Drizzle v1's `migrations/<timestamp>_<name>/migration.sql` folders, splits their statement breakpoints and embeds the SQL with SHA-256 checksums in the private server artifact. To use another directory, set `server.migrations` in `tailorkit.config.ts`. An explicitly configured directory must exist. An absent default `./migrations` directory is allowed only when there are no schema tables to migrate. Older `_journal.json` migration layouts are unsupported.

Before bundling, the builder uses Drizzle Kit to generate a fresh snapshot of `src/schema.ts` in a temporary directory and compares its schema entities with the latest committed migration snapshot. Missing or stale migrations fail the build with a `tailorkit db generate` instruction. This check does not write to migration history, connect to a database, or check deployed database state. Generating migrations stays an explicit step so SQL can be reviewed. The builder watches the schema and migration files in watch mode.

When an installation's SQLite facet starts, the framework synchronously checks its `tailorkit_migrations` journal and applies missing migrations before exposing queries or mutations. The entire pending upgrade and its journal entries run in one storage transaction. Failed upgrades roll back and prevent that facet from serving database calls. Each installation upgrades independently when accessed, including installations created after deployment. Actions that call queries or mutations use this same initialized facet.

Migration history is append-only: never edit, delete or insert migrations before already applied entries. Their IDs and checksums must match the stored history. Republishing code with an older migration history is rejected; automatic database downgrades are unsupported. Keep migrations small enough for the runtime's existing 10 ms CPU limit; large backfills need a separate workflow. Existing databases created outside this migration flow are not automatically adopted.

Subscriptions use oRPC with Durable Object hibernation. The trusted installation persists query registrations and dependencies, restores them after wake-up, and uses durable alarms for token expiry. Each installation serializes database calls and query reruns in its trusted realtime coordinator; action database calls pass through the trusted bridge into that same coordinator, with limits of 128 connections and 256 active queries. CPU/subrequest limits apply to isolated app code; installation quotas and receipt retention remain future work. It supports one live deployment per installation, full snapshots and table-level tracking. Offline sync, optimistic updates, middleware, Redis notification delivery and advanced dependency tracking are deferred.

Application bundles export a `runtimeManifest` alongside the default application definition and migrations. The SDK builder emits `{ apiVersion: 1, requires: ["database", "actions"] }`. The facet validates the exports, API version and required features before touching SQLite. Unsupported bundles fail with `INCOMPATIBLE_VERSION`. Breaking handler/module changes increment `apiVersion`; additive capabilities can be named in `requires`. Bundles only require a runtime upgrade when their declared interface or required features are unsupported. The shared `ApplicationModule` and `RuntimeManifest` types are exported by `@tailorkit/app/server`.

Server builds inline dynamic imports into the single uploaded `server/server.js` file. Deployment type checking covers both configured client and server entries. Existing mounted clients reconnect after server updates without losing their UI state; server changes must remain compatible with those clients.
