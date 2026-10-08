# Todo

This example stores todos in the app backend's installation-scoped SQLite database using `tailorkit/server`. The view subscribes to the `list` query, so committed add, edit, toggle and delete mutations update every active client. Text edits stay in a local draft until **Save** is clicked. Arguments are validated with Zod, and todo rows are inferred from the database schema.

`src/slots/` contains the UI, `src/functions/` contains `tk.query`, `tk.mutation` and `tk.action` definitions, and `src/db/schema.ts` defines the SQLite table and validation schemas. `src/server.ts` registers the functions. `src/client.ts` uses `component: ClientProvider` to share one backend client across views. The UI uses `useQuery`, `useMutation` and `useAction` for live data, pending state and errors, with no manual subscriptions or cleanup.

**Import a sample todo** demonstrates an async action: it fetches a todo from JSONPlaceholder, validates the response and calls the `add` mutation. External calls run in actions; queries and mutations use synchronous database handlers.

The client receives its backend session through the host bridge. The host SDK uses its existing `authenticate` callback and forwards verified scopes to the platform, which authorizes the app and resolves its installation and runtime URL. No additional host backend configuration is required. No runtime URL, installation ID or credentials are supplied by this example.

`src/server.ts` default-exports the app. Views import `api` from `#tailorkit`; its input/output types follow the server functions immediately, without building or generating backend references. The shared module imports the server only as a type and infers `typeof app.functions`, keeping the schema and handlers out of the browser bundle. `tailorkit build` builds the client and private server without changing source files.

The builder bundles the committed Drizzle migrations from `src/db/migrations/` into the private server. Each installation applies pending migrations before its database handlers run. After changing `src/db/schema.ts`, run `pnpm --filter todo db:generate`, commit the generated migration folder, then rebuild and deploy. Generation needs no running database. Keep applied migration files unchanged; subsequent changes should append new migrations.

Builds check `src/db/schema.ts` against the latest saved migration snapshot and fail with a generation instruction if migrations are missing or stale. Builds do not change migration history. Migration source files live in `src/db/migrations/`; build copies live in `.tailorkit/migrations/`.

`pnpm db:generate` uses `tailorkit db generate`. No Drizzle config file is needed: the schema is `src/db/schema.ts`, and generation and builds share the migration directory configured in `tailorkit.config.ts` (root `src/db/migrations/` by default). Pass `--name` to name a migration.

`src/db/relations.ts` calls Drizzle's `defineRelations(schema)` and is the place to add relationships between tables. `src/db/index.ts` exports `db = defineDatabase({ relations })` and re-exports the schema. The relations object already includes the tables, so `defineDatabase` needs no separate schema import.

Pass this definition to `tk.query.database(db)` or `tk.mutation.database(db)` (or the `database` option on `query`/`mutation`). Handlers receive typed `db.query` access alongside the existing select/insert/update/delete builders. Relational queries use `.sync()`, for example `db.query.todos.findMany({ orderBy: { id: "asc" }, limit: 1000 }).sync()`. Queries and mutations remain synchronous; actions call them through their function collections.
