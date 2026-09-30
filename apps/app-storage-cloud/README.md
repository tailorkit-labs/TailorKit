# Cloudflare app storage

This is the Wrangler project for the trusted app storage supervisor. `wrangler.jsonc` points directly to `src/index.ts`; Wrangler handles bundling and watching without a custom build script or Vite configuration.

The supervisor loads serialized app code into isolated Dynamic Worker facets. Each verified installation has stable SQLite storage. App code receives no namespace, supervisor data, JWT or secrets. Migrations are initiated explicitly by the CLI.

## Local development

Build the SDK and the [persistent todo example](../../examples/apps/persistent-todo/README.md) first. From the repository root, run this project against that app's generated configuration:

```sh
pnpm --filter @tailorkit/app-storage-cloud dev src/index.ts \
  --config "$PWD/examples/apps/persistent-todo/.tailorkit-storage/wrangler.json" \
  --persist-to "$PWD/examples/apps/persistent-todo/.tailorkit-storage/state" \
  --port 8787
```

The generated config supplies the app artifact alias, trusted host public keys and stable Worker name. The `src/index.ts` argument selects this project's entry point. Run the example's migrate, seed and host commands in another terminal. Stop any other storage runtime using port 8787 first. For app server/client watching as well, use the example's `storage:dev` command.

## Project configuration

To configure this project's own `wrangler.jsonc`, point `alias.app-storage-artifact` at an app's generated `.tailorkit-storage/artifact.json`, then copy its Worker name and `vars` from the generated `wrangler.json`. Keep the Worker name, DO class/namespace identity and trust settings stable across updates. Renaming this workspace does not require changing those identities.

The checked-in artifact is an unconfigured placeholder. It allows clean repository builds and returns HTTP 503 until an app artifact is selected. It contains no app implementation or signing keys.

Validate the configured project without deploying:

```sh
pnpm --filter @tailorkit/app-storage-cloud build
pnpm --filter @tailorkit/app-storage-cloud check-types
```

There is no automatic deployment command. See the [storage reference](../../packages/app-storage/README.md) for migration and compatibility requirements. The standalone workerd/Docker alternative lives in [app-storage-selfhost](../../packages/app-storage-selfhost/README.md).
