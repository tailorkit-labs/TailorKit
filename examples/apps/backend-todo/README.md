# Backend todo

A small app using `tailorkit/server`: SQLite tables, typed queries/mutations/actions, and direct WebSocket subscriptions supplied with JWTs by the host bridge. Its UI reuses TailorKit's existing remote `Box`, `Flex` and `Button` components.

Backend functions live in `src/functions/` and use the chained `tk` API. `src/schema.ts` defines tables, `src/server.ts` registers functions, and `src/views/` uses `useQuery`, `useMutation` and `useAction`. The client root installs `ClientProvider`, which owns the connection and cleans up subscriptions automatically.

```sh
pnpm --filter @tailorkit/app build
pnpm --filter tailorkit build
pnpm --filter @tailorkit/cli build
pnpm --filter backend-todo build
pnpm --filter @tailorkit/apps-worker test
```

The runtime integration test bundles this server, loads it from disposable local R2, initializes its schema with the bundled Drizzle-generated migrations, and connects two clients to the same installation. It verifies shared updates, deduplication, token renewal, writes surviving a workerd restart, and an action importing a todo from a mocked external API while other clients keep writing. It deploys nothing and requires no platform or Cloudflare credentials.

For a hosted deployment, set `appId` and `host` in `tailorkit.config.ts`, then use `tailorkit deploy`. Both the public client and private server go through the platform's normal blob upload flow. The server artifact includes the committed `migrations/` migrations. Each installation applies pending migrations before database calls run. After changing `src/schema.ts`, run `pnpm --filter backend-todo db:generate`, commit the generated migration folder, then rebuild and deploy.

`src/server.ts` default-exports the app. Views import `api` from `#tailorkit`, whose type-only server import infers the current functions without a build step. The app definition and SQLite schema stay in the private server artifact; builds do not generate backend reference files.

The “Import from an external API” button calls `importTodo`. Its action fetches JSON and calls `ctx.mutations.add(...)`; the mutation updates every active todo subscription. The integration test substitutes the external API, so tests make no Internet requests.

Builds check `src/schema.ts` against the latest saved migration snapshot and fail with a generation instruction if migrations are missing or stale. Builds do not change migration history. Migration source files live in `migrations/`; build copies live in `.tailorkit/migrations/`.

`pnpm db:generate` uses `tailorkit db generate`. No Drizzle config file is needed: the schema is `src/schema.ts`, and generation and builds share the migration directory configured in `tailorkit.config.ts` (root `migrations/` by default). Pass `--name` to name a migration.
