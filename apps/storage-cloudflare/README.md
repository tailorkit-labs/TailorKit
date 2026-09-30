# Cloudflare app storage supervisor

This service packages a trusted supervisor independently from the untrusted app facet. The TailorKit app builder generates `.tailorkit-storage/artifact.json` and a Wrangler configuration containing trusted host public keys and stable namespace settings.

From the repository root, after building the SDK and app:

```sh
TAILORKIT_STORAGE_ARTIFACT="$PWD/examples/apps/persistent-todo/.tailorkit-storage" \
  pnpm --filter @tailorkit/storage-cloudflare bundle
```

The output is `dist/worker.js` and `dist/wrangler.json`. Use Wrangler locally with that config or provision it through your own deployment workflow. Keep its worker name, DO namespace/class identity and trust settings stable. The package has no automatic deployment command.

The supervisor loads the app as a Dynamic Worker and gives each verified installation an isolated, stable SQLite facet. App code receives no namespace, supervisor data, JWT or secrets. Migrations are initiated explicitly by the CLI; see the [storage reference](../../packages/app-storage/README.md).
