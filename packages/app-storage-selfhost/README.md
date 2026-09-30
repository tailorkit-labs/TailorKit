# Self-hosted app storage

Standalone workerd runs the same trusted supervisor and isolated Dynamic Worker facets as the Cloudflare adapter. No Cloudflare account is needed.

Build the app first, then from the repository root:

```sh
TAILORKIT_STORAGE_ARTIFACT="$PWD/examples/apps/persistent-todo/.tailorkit-storage/docker" \
  docker compose -f packages/app-storage-selfhost/compose.yaml up --build -d
```

The app builder produces the mounted `worker.js` and `workerd.capnp`. The Compose service uses a named `/data` volume for installation SQLite databases. Its project name remains `storage-docker` so moving this package preserves existing default volumes; keep using your existing `COMPOSE_PROJECT_NAME` if you set one. Recreate the container after code changes, then run CLI migrations for installations with pending schema changes. Preserve the namespace and volume across updates. Keep app artifacts and configuration under operator control.

The container runs as an unprivileged user with a read-only filesystem, no added capabilities and bounded memory/CPU/process count. App execution has no network access or bindings. The default listener is loopback port 8787; configure TLS at a reverse proxy and set trusted host keys/origins in the generated artifact for remote use.

This is a single-instance alternative. Do not share a data directory between running replicas. workerd disk-backed Durable Objects are experimental; back up the volume and validate runtime upgrades. Cloudflare-managed replication and all managed resource limits are not reproduced. See the [tutorial](../../examples/apps/persistent-todo/README.md) and [storage reference](../app-storage/README.md).
