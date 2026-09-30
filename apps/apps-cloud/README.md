# Cloudflare app storage

This Wrangler project owns the shared gateway, trusted supervisor and isolated Dynamic Worker facets. `src/index.ts` is the production entry point. It contains no app code or artifact alias; adding an app does not require redeploying this Worker.

## Code uploads and loading

`tailorkit deploy` uploads the browser bundle to `deployments/<deployment>/client/client.js` and an optional server bundle to `deployments/<deployment>/server/server.js` in the existing private blob bucket. Both uploads are checksum-verified before publication. The public asset gateways only serve allowed client filenames and logos. They never serve server bundles or generate server download URLs.

The supervisor verifies the host JWT, resolves the authorized app's published server through the authenticated platform API, downloads it using a 60-second private URL and verifies its SHA-256 checksum and size before loading it. The URL and platform credential stay in the supervisor. App code receives no JWT, secrets, namespace, network access or supervisor database. Each installation has a stable facet name and isolated SQLite storage; code updates restart the facet without replacing its database.

Configure the deployed project's bindings:

- `STORAGE_ISSUER`, `STORAGE_AUDIENCE`, `STORAGE_PUBLIC_KEYS`, `STORAGE_ORIGINS`: trusted host configuration.
- `PLATFORM_URL`: platform API base, for example `https://tailorkit.dev/api/platform`.
- `PLATFORM_TOKEN`: project-host API key; set using a Wrangler secret. Never give this key to app developers.
- `STORAGE_SCOPE`: JSON platform scope used by this host installation environment.
- `STORAGE_APP_ID`: optional additional app restriction. Leave blank to accept apps authorized by this host's signing keys and platform project/scope.

This initial configuration supports multiple apps for one trusted host/project/scope. Mapping several independent hosts/projects to one gateway is future work. Keep Worker/DO namespace identities stable across updates. The underlying bucket must remain private; the asset gateways provide public client access.

## Migrations are deferred remotely

The uploaded `server.js` is built separately with no migration history. No migration SQL, snapshots, hashes or local artifact JSON are uploaded. Remote migration requests are rejected until a migration design is chosen. A new remote installation cannot execute database functions until its schema and runtime journal have been prepared; this change does not invent automatic schema creation. Local generated migrations and CLI commands remain available for development.

## Local development

Build the SDK and the [persistent todo example](../../examples/apps/persistent-todo/README.md), then run:

```sh
pnpm --filter persistent-todo storage:dev
```

The generated local Wrangler config selects `src/dev.ts`, which loads that app's local artifact for watching and local migrations. This development-only entry is separate from the production entry. Persistent local data stays in `.tailorkit-storage/state`, outside directories cleared by the app builder.

Validate without deploying:

```sh
pnpm --filter @tailorkit/apps-cloud build
pnpm --filter @tailorkit/apps-cloud check-types
pnpm --filter @tailorkit/apps-cloud test
```

## Service boundaries

The provider-neutral SDK owns schema/database wrappers, query/mutation execution, the oRPC protocol and Effect v4 services. This app supplies Cloudflare persistence, notification delivery, authentication/routing, private artifact retrieval and build/development tools. The CLI uploads code through TailorKit credentials and never needs access to Cloudflare.

Workerd is used only for local development and isolated metadata inspection. Self-hosted execution remains deferred.
