# Persistent todo: two sandboxed clients

This example renders two TailorKit sandboxes connected to one installation. Add, complete or remove a todo in either client to see both update. Data survives a runtime restart and code rebuild.

Run these commands from the repository root with Node 24 and pnpm installed:

```sh
pnpm install
pnpm exec turbo run build --filter=@tailorkit/cli --filter=@tailorkit/react --filter=@tailorkit/ui
pnpm --filter persistent-todo storage:init
pnpm --filter persistent-todo build
```

`storage:init` creates ignored loopback development signing keys. Run it once. The example build also initializes missing keys on a clean checkout, including CI. The initial Drizzle migration is already committed; run `pnpm --filter persistent-todo storage:generate` after editing the schema, then rebuild.

Start the runtime and the example host in separate terminals:

```sh
pnpm --filter persistent-todo storage:dev
```

```sh
pnpm --filter persistent-todo storage:migrate
pnpm --filter persistent-todo storage:seed
pnpm --filter persistent-todo dev:host
```

Open <http://localhost:5011>. The example host authorizes its fixed local user and installation; replace that resolver with real membership/session checks in your host application. These keys and this Vite host are only for local development.

`storage:dev` watches the app client, server, public keys and migration directory. The configured `@tailorkit/apps-cloud/tooling` adapter is provided by `apps/apps-cloud`; all Cloudflare execution/build tooling lives there. `namespace` keeps the Worker and installation storage identities stable. Wrangler persists SQLite in `.tailorkit-storage/state`, outside the directories emptied by the builder. Server code updates preserve the installation and facet database. A schema update requires rebuilding and explicitly running `storage:migrate` again. To clear local data, stop the runtime, run `pnpm --filter persistent-todo storage:reset`, restart, migrate and seed. Reset leaves development keys and generated migration files intact.

## Validate

The integration checks use disposable state rather than the demo's data:

```sh
pnpm --filter persistent-todo storage:verify
pnpm --filter persistent-todo storage:verify:isolation
```

The Wrangler transport check covers CLI migration authorization, required migrations, migration replay, separate installation data, two-client updates, mutation deduplication, wrong JWT issuer/audience, API mismatch, token renewal, persisted data and reconnect after runtime restart. The isolation check uses Wrangler with disposable state and runs adversarial code to check blocked egress, empty bindings, stripped JWTs, verified identities, isolated globals/storage, build-time isolation and persistent data after a code update.

## Uploading

`tailorkit deploy` uploads client code and a separate, migration-free server bundle through the normal TailorKit deployment flow. A production `apps-cloud` gateway fetches published server code privately at runtime. App developers need TailorKit credentials only. Remote schema initialization/migrations are deferred; the local example remains the full persistence/realtime demonstration.
