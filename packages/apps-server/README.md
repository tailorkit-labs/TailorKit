# @tailorkit/apps-server

Apache-2.0 app backend SDK. Define SQLite tables and synchronous queries/mutations with Zod arguments. Drizzle and oRPC v2 run underneath; app code uses this package's APIs.

```ts
import { defineApp, table, text, mutation, query } from "@tailorkit/apps-server";
import { z } from "zod";

const notes = table("notes", { id: text().primaryKey(), title: text().notNull() });

export default defineApp({
  list: query({
    args: z.object({}),
    handler: ({ db }) => db.select().from(notes).all(),
  }),
  add: mutation({
    args: z.object({ title: z.string().min(1) }),
    handler: ({ db, args, identity }) =>
      db.insert(notes).values({ id: crypto.randomUUID(), title: args.title }).returning().get(),
  }),
});
```

Handlers receive validated `args`, `db`, and verified `identity` (`userId`, `projectId`, `appId`, `installationId`, `deploymentId`, `expiresAt`). Queries expose selection builders; mutations additionally expose insert/update/delete. Use synchronous `.all()`, `.get()` and `.run()`. Async handlers are rejected: writes, result validation and the accepted-write receipt commit in one synchronous transaction. Optional `result: zodSchema` validates the output before commit. Throw `AppError` for an intentional public error; unexpected errors are hidden.

Schema exports include `table`, `text`, `integer`, `real`, `boolean` and common comparison/order operators. This is a small supported surface. Apps can import Drizzle for advanced configurations, but those features are not guaranteed to work with tracking or this driver.

## Build and upload

Add `server: { entry: "./src/server.ts", references: "./src/server.gen.ts" }` to `tailorkit.config.ts` (these paths are defaults). `tailorkit build` emits `.tailorkit-server/server.js`, the isolated Cloudflare facet, and generates typed references. References import the server module **only as a TypeScript type**; no implementation is evaluated or bundled in the browser. The browser builder rejects server implementation imports.

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

The runtime test runs disposable local Wrangler/workerd/R2 state and two clients against the example's real backend. It checks persistent writes, atomic replay protection, realtime snapshots, JWT renewal and recovery after restart. It needs no Cloudflare account and deploys nothing. See `examples/apps/backend-todo` and the runtime README.

Database migration delivery and production schema initialization are deliberately deferred. `table()` defines a Drizzle-compatible schema; it does not create tables at runtime. A fresh production installation needs its app tables created before queries work. Tests alone initialize their disposable tables using the existing Drizzle-generated fixture SQL; no migration files are uploaded.

This initial implementation uses standard WebSockets, not Durable Object hibernation. Active connections keep the supervisor awake. Each installation serializes calls and query reruns, with limits of 128 connections and 256 active queries. CPU/subrequest limits apply to isolated app code; installation quotas and receipt retention remain future work. It supports one live deployment per installation, full snapshots and table-level tracking. Offline sync, optimistic updates, middleware, Redis notification delivery and advanced dependency tracking are deferred.
