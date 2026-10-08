# Backend todo

A small app using `tailorkit/server`: SQLite tables, typed queries/mutations/actions, and direct WebSocket subscriptions supplied with JWTs by the host bridge. Its UI reuses TailorKit's existing remote `Box`, `Flex` and `Button` components.

Backend functions live in `src/functions/` and use the chained `tk` API. `src/db/schema.ts` defines tables, `src/server.ts` registers functions, and `src/slots/` uses `useQuery`, `useMutation` and `useAction`. The client root installs `ClientProvider`, which owns the connection and cleans up subscriptions automatically.

`src/slots/page/index.tsx` declares `slot: "page"` in `defineView` and also defines an `instances` resolver. It runs on the server, calls the registered `list` query, and returns an “All todos” instance plus each todo's stable key, title metadata, and validated `{ todoId }` data. The view reads `view.useInstance()` to display all todos or the selected task.

The Next.js and TanStack Start hosts use `useSlot({ slot: "page" })` to discover instances across all apps, filter by `instance.app.id` to populate an app’s instance picker, then render `<Slot app={app} name="page" instanceKey={selected.key} />`. Refresh the picker after adding or removing tasks. The hosts declare `page: { views: ["/"], multiple: true }`. Multi-instance slots require an instance key; the single-instance `panel` slot renders without one.

Hosts that already have the complete context and instance can render `<Slot.Controlled app={app} name="page" view="/" status="ready" context={context} instance={selected} />` directly. The instance data stays opaque to the host; its type is inferred from `instances.dataSchema` inside the app.

```sh
pnpm --filter @tailorkit/app build
pnpm --filter tailorkit build
pnpm --filter @tailorkit/cli build
pnpm --filter backend-todo build
pnpm --filter @tailorkit/apps-worker test
```

Inspect `.tailorkit/server/server.js` for the extracted resolver and its data schema. Call it through `_tailorkit.instances.resolve` with `{ slot: "page", path: "/", context: {} }`. The resolver implementation and schema stay out of the client bundle. `.tailorkit/client/views.json` contains the slot/view manifest with `instances: true` on views that support instances, and `.tailorkit/tailorkit-upload.json` lists the deployable artifacts.

The runtime integration test bundles this server, loads it from disposable local R2, initializes its schema with the bundled Drizzle-generated migrations, and connects two clients to the same installation. It verifies shared updates, deduplication, token renewal, writes surviving a workerd restart, and an action importing a todo from a mocked external API while other clients keep writing. It deploys nothing and requires no platform or Cloudflare credentials.

For a hosted deployment, set `appId` and `host` in `tailorkit.config.ts`, then use `tailorkit deploy`. Both the public client and private server go through the platform's normal blob upload flow. The server artifact includes the committed `src/db/migrations/` migrations. Each installation applies pending migrations before database calls run. After changing `src/db/schema.ts`, run `pnpm --filter backend-todo db:generate`, commit the generated migration folder, then rebuild and deploy.

`src/server.ts` default-exports the app. Views import `api` from `#tailorkit`, whose type-only server import infers the current functions without a build step. The app definition and SQLite schema stay in the private server artifact; builds do not generate backend reference files.

The “Import from an external API” button calls `importTodo`. Its action fetches JSON and calls `ctx.mutations.add(...)`; the mutation updates every active todo subscription. The integration test substitutes the external API, so tests make no Internet requests.

Builds check `src/db/schema.ts` against the latest saved migration snapshot and fail with a generation instruction if migrations are missing or stale. Builds do not change migration history. Migration source files live in `src/db/migrations/`; build copies live in `.tailorkit/migrations/`.

`pnpm db:generate` uses `tailorkit db generate`. No Drizzle config file is needed: the schema is `src/db/schema.ts`, and generation and builds share the migration directory configured in `tailorkit.config.ts` (root `src/db/migrations/` by default). Pass `--name` to name a migration.

`src/db/relations.ts` calls Drizzle's `defineRelations(schema)` and is the place to add relationships between tables. `src/db/index.ts` exports `db = defineDatabase({ relations })` and re-exports the schema. The relations object already includes the tables, so `defineDatabase` needs no separate schema import.

Pass this definition to `tk.query.database(db)` or `tk.mutation.database(db)` (or the `database` option on `query`/`mutation`). Handlers receive typed `db.query` access alongside the existing select/insert/update/delete builders. Relational queries use `.sync()`, for example `db.query.todos.findMany({ orderBy: { id: "asc" }, limit: 1000 }).sync()`. Queries and mutations remain synchronous; actions call them through their function collections.
