# Cloudflare app storage

This is the Cloudflare runtime and Wrangler project for app storage. It owns the supervisor, isolated Durable Object facets, binding types, Wrangler startup, and isolated build inspection. `wrangler.jsonc` points directly to `src/index.ts`; Wrangler handles bundling and watching without a custom build script or Vite configuration.

The supervisor loads serialized app code into isolated Dynamic Worker facets. Each verified installation has stable SQLite storage. App code receives no namespace, supervisor data, JWT or secrets. Migrations are initiated explicitly by the CLI.

## Local development

Build the SDK and the [persistent todo example](../../examples/apps/persistent-todo/README.md) first. From the repository root, run this project against that app's generated configuration:

```sh
pnpm --filter @tailorkit/apps-cloud dev src/index.ts \
  --config "$PWD/examples/apps/persistent-todo/.tailorkit-storage/wrangler.json" \
  --persist-to "$PWD/examples/apps/persistent-todo/.tailorkit-storage/state" \
  --port 8787
```

The generated config supplies the app artifact alias, trusted host public keys and stable Worker name. The `src/index.ts` argument selects this project's entry point. Run the example's migrate, seed and host commands in another terminal. Stop any other storage runtime using port 8787 first. For app server/client watching as well, use the example's `storage:dev` command.

## Project configuration

To configure this project's own `wrangler.jsonc`, point `alias.app-storage-artifact` at an app's generated `.tailorkit-storage/artifact.json`, then copy its Worker name and `vars` from the generated `wrangler.json`. The example selects this adapter with `storage.adapter: "@tailorkit/apps-cloud/tooling"` and a stable `storage.namespace`. Keep the Worker name, DO class/namespace identity and trust settings stable across updates. Renaming this workspace does not require changing those identities.

The checked-in artifact is an unconfigured placeholder. It allows clean repository builds and returns HTTP 503 until an app artifact is selected. It contains no app implementation or signing keys.

Validate the configured project without deploying:

```sh
pnpm --filter @tailorkit/apps-cloud build
pnpm --filter @tailorkit/apps-cloud check-types
```

There is no automatic deployment command. See the [storage reference](../../packages/app-storage/README.md) for migration and compatibility requirements.

## Service boundaries

The SDK owns the provider-neutral schema, database wrappers, query/mutation engine, HTTP/SSE protocol and Effect v4 service contracts. This app supplies Cloudflare Layers for authentication/routing, synchronous facet SQL persistence, separate notification delivery, and build/development tooling. `StorageTools` has three operations: inspect, build and start. The shared builder and CLI load the configured trusted adapter instead of importing Cloudflare APIs. Node 24 handles the adapter's TypeScript source.

Workerd remains a local development/build dependency: inspection evaluates app metadata in a network-disabled disposable isolate with a hard process timeout. It is not a self-hosted service. No Docker runtime, container configuration or standalone persistent server is included. A future runtime can implement the same services without changing app or browser APIs.
