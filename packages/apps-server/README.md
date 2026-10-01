# @tailorkit/apps-server

Apache-2.0 app backend SDK. Define SQLite tables, synchronous queries/mutations and async actions with Zod arguments. Drizzle and oRPC v2 run underneath; app code uses this package's APIs.

```ts
import { defineApp, table, text, mutation, query } from "@tailorkit/apps-server";
import { z } from "zod";

const notes = table("notes", { id: text().primaryKey(), title: text().notNull() });

const functions = {
  list: query({
    args: z.object({}),
    handler: ({ db }) => db.select().from(notes).all(),
  }),
  add: mutation({
    args: z.object({ title: z.string().min(1) }),
    handler: ({ db, args, identity }) =>
      db.insert(notes).values({ id: crypto.randomUUID(), title: args.title }).returning().get()!,
  }),
};

export default defineApp(functions);
```

Handlers receive validated `args`, `db`, and verified `identity` (`userId`, `projectId`, `appId`, `installationId`, `deploymentId`, `expiresAt`). Queries expose selection builders; mutations additionally expose insert/update/delete. Use synchronous `.all()`, `.get()` and `.run()`. Async query/mutation handlers are rejected: writes, result validation and the accepted-write receipt commit in one synchronous transaction. Optional `result: zodSchema` validates the output before commit. Throw `AppError` for an intentional public error; unexpected errors are hidden.

Schema exports include `table`, `text`, `integer`, `real`, `boolean` and common comparison/order operators. This is a small supported surface. Apps can import Drizzle for advanced configurations, but those features are not guaranteed to work with tracking or this driver.

## Queries, mutations and actions

| Type     | Database access                         | External calls | Automatic query reruns                    |
| -------- | --------------------------------------- | -------------- | ----------------------------------------- |
| Query    | Read only                               | Blocked        | When subscribed                           |
| Mutation | Read/write in one atomic transaction    | Blocked        | Invalidates affected queries after commit |
| Action   | Through `ctx.queries` / `ctx.mutations` | Async HTTPS    | Its mutations trigger normal invalidation |

Use `action({ functions?, args, result?, handler })` for external API calls. Action handlers receive validated `args`, verified `identity`, an abort `signal`, and typed `ctx.queries.<name>(args)` / `ctx.mutations.<name>(args)` methods. They have no `db` handle. Actions can be synchronous or async; query/mutation handlers remain synchronous.

Pass a shared query/mutation collection as `functions`, and register that same collection under the same names in `defineApp`. The namespaces expose only the declared queries and mutations; their argument and result types are inferred from the definitions. No generated client references are needed on the server. Actions with no database calls can omit `functions`.

To extend the example above, add this action and include it in the app:

```ts
import { action } from "@tailorkit/apps-server";

const importNote = action({
  functions,
  args: z.object({ url: z.url() }),
  async handler(ctx) {
    await ctx.queries.list({});
    const response = await fetch(ctx.args.url, { signal: ctx.signal });
    const data = z.object({ title: z.string() }).parse(await response.json());
    return ctx.mutations.add({ title: data.title });
  },
});

export default defineApp({ ...functions, importNote });
```

Clients call `await client.action(api.importNote, { url })`. Actions are one-shot calls, never subscriptions, and are not automatically retried. Every query/mutation call executes separately; the action as a whole is not a transaction. An earlier mutation stays committed if later external work or result validation fails. Combine related database writes into one mutation when they must be atomic. External writes need the provider's idempotency mechanism before retrying an action. Mutation methods accept an optional second argument `{ requestId }`, for example `ctx.mutations.add({ title }, { requestId })`, to reuse the normal mutation receipt when explicitly retrying a database step.

Cloudflare runs each action in a fresh stateless Dynamic Worker, separate from the network-blocked SQLite facet. A trusted callback binding fixes its installation, user and deployment; it cannot choose another store or access platform credentials. The HTTPS gateway checks destinations and redirects, rejects literal private/loopback addresses and local/internal hostnames, and forwards no platform credentials. Action database calls pass through the same realtime coordinator as client calls, so successful writes update active subscriptions. External I/O holds neither the database queue nor the realtime queue.

The initial limits are 16 concurrent actions per installation, 64 database/outbound calls per action, 50 ms CPU and 30 seconds elapsed time (also bounded by JWT expiry). Completion, disconnection, cancellation or expiry revokes callbacks; already committed writes and accepted external effects remain committed. Actions are not durable jobs. Nested action calls, scheduling, internal-only functions and app-secret management are deferred.

## Source layout

- `src/database/`: SQLite schema builders, database types and the tracked Drizzle driver.
- `src/server/`: query/mutation/action definitions, atomic database execution, async action execution, realtime coordination and server RPC transport. Tests live beside the implementation.
- `src/client/`: browser WebSocket connection, typed references and the host JWT session provider.

The root `index.ts`, `client.ts` and `runtime.ts` files expose the existing public entry points. `errors.ts` is shared by the client and server. Cloudflare-specific adapters remain in `apps/apps-runtime`.

## Build and upload

Add `server: { entry: "./src/server.ts", references: "./src/server.gen.ts" }` to `tailorkit.config.ts` (these paths are defaults). `tailorkit build` emits `.tailorkit-server/server.js`, containing the isolated SQLite facet and stateless action entry point, and generates typed references. References import the server module **only as a TypeScript type**; no implementation is evaluated or bundled in the browser. The browser builder rejects server implementation imports.

`tailorkit deploy` uploads the client and private server artifact through existing platform-issued blob upload URLs. Apps need no Cloudflare credentials. R2 stores them under separate `client/` and `server/` prefixes; only client assets are public. Client-only apps continue to build without a server artifact. Watch mode watches both builds; generated output stays separate from `.tailorkit`.

## Client

```ts
import { createClient } from "@tailorkit/apps-server/client";
import { api } from "./server.gen";

const client = createClient();
const stop = client.subscribe(api.list, {}, (notes) => render(notes));
await client.mutate(api.add, { title: "Shared with every active client" });
stop(); // Abort this query stream and unregister its subscription.
client.close(); // Close the client's connection when it is no longer needed.
```

One oRPC WebSocket carries calls and full query snapshots. The sandbox bridge supplies scoped JWTs only; backend traffic connects directly to the host-authorized runtime origin. The host SDK caches sessions and renews them shortly before the two-minute token expires. The socket reconnects five seconds before expiry, resubscribes active queries and receives fresh snapshots. No subscription pings or per-query expiry leases are required. A broken connection drops server subscriptions; reconnect creates new subscriptions. Inactive/unsubscribed queries receive no updates.

To retry a mutation whose response was lost, retain a UUID and pass `{ requestId }` to each attempt. The atomic receipt returns the original result without writing or invalidating again. Reusing that UUID with different arguments or identity is rejected. Calls do not automatically retry accepted writes with a new UUID.

## Reactivity and provider boundary

The Drizzle driver records tables read by each query, including empty selections and joins, and tables changed by successful writes. Only committed writes invalidate. The supervisor reruns affected active queries as their original verified users and replaces each dependency set. Initial subscription registration and mutations share a queue, avoiding an initial-snapshot race. Slow consumers retain the latest complete pending snapshot.

`./runtime` provides a synchronous `Persistence` contract, shared execution, a separate asynchronous `Execution` contract, realtime coordination and an oRPC connection adapter. Cloudflare SQL/facet code stays in `apps/apps-runtime`. Its trusted deployment/execution orchestration uses private Effect v4 services. An alternative provider can replace persistence/execution/delivery without requiring app authors or browser clients to use Effect.

## Local validation and current limits

```sh
pnpm --filter @tailorkit/app-storage build
pnpm --filter @tailorkit/apps-server build
pnpm --filter @tailorkit/app build
pnpm --filter backend-todo build
pnpm --filter @tailorkit/apps-server test
pnpm --filter @tailorkit/apps-runtime test
```

The runtime test runs disposable local Wrangler/workerd/R2 state and two clients against the example's real backend, including an external API action and writes continuing while it waits. It checks persistent writes, atomic replay protection, realtime snapshots, JWT renewal and recovery after restart. It needs no Cloudflare account and deploys nothing. See `examples/apps/backend-todo` and the runtime README.

Database migration delivery and production schema initialization are deliberately deferred. `table()` defines a Drizzle-compatible schema; it does not create tables at runtime. A fresh production installation needs its app tables created before queries work. Tests alone initialize their disposable tables using the existing Drizzle-generated fixture SQL; no migration files are uploaded.

This initial implementation uses standard WebSockets, not Durable Object hibernation. Active connections keep the supervisor awake. Each installation serializes database calls and query reruns, with limits of 128 connections and 256 active queries. CPU/subrequest limits apply to isolated app code; installation quotas and receipt retention remain future work. It supports one live deployment per installation, full snapshots and table-level tracking. Offline sync, optimistic updates, middleware, Redis notification delivery and advanced dependency tracking are deferred.
