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

`storage:dev` watches the app client, server, public keys and migration directory. Wrangler persists SQLite in `.tailorkit-storage/state`, outside the directories emptied by the builder. Server code updates preserve the installation and facet database. A schema update requires rebuilding and explicitly running `storage:migrate` again. To clear local data, stop the runtime, run `pnpm --filter persistent-todo storage:reset`, restart, migrate and seed. Reset leaves development keys and generated migration files intact.

## Use Docker instead of Wrangler

Build the shared self-hosted image once:

```sh
docker build -t tailorkit-storage:local packages/app-storage-selfhost
pnpm --filter persistent-todo storage:docker
```

Then run the same migrate, seed and host commands above. Docker development data lives in `.tailorkit-storage/state/docker`, separate from Wrangler's state. Do not run Wrangler and Docker on port 8787 together. The dev command watches the mounted supervisor bundle; the image needs rebuilding only when its runtime changes.

For a persistent service managed by Compose:

```sh
TAILORKIT_STORAGE_ARTIFACT="$PWD/examples/apps/persistent-todo/.tailorkit-storage/docker" \
  docker compose -f packages/app-storage-selfhost/compose.yaml up --build -d
```

Compose uses its own named data volume. Preserve that volume across container updates; `storage:reset` does not delete it. The service binds to loopback. Add a TLS reverse proxy and configure trusted issuer/keys/origins for external use. See [runtime details and limits](../../../packages/app-storage/README.md).

## Validate

The integration checks use disposable state rather than the demo's data:

```sh
pnpm --filter persistent-todo storage:verify
pnpm --filter persistent-todo storage:verify:docker
pnpm --filter persistent-todo storage:verify:isolation
```

Both transport checks cover CLI migration authorization, required migrations, migration replay, separate installation data, two-client updates, mutation deduplication, wrong JWT issuer/audience, API mismatch, token renewal, persisted data and reconnect after runtime restart. The isolation check runs adversarial code to check blocked egress, empty bindings, stripped JWTs, verified identities, isolated globals/storage, build-time isolation and persistent data after a code update.
