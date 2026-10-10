# TailorKit CLI

Command-line tools for developing and publishing TailorKit extensions.

`tailorkit agent --host http://localhost:3000/api/tailorkit` can build against a
running local host. Each chat turn reads the host schema locally and sends it to
the remote agent workspace for scaffolding and type generation. The host must be
configured with a TailorKit project; a public host deployment is not required.

To scaffold or regenerate using a serialized host schema JSON file, pass
`--schema` to either command. Paths are relative to `--cwd` (the current directory
by default). The host URL is still required in init or the app config.

```sh
tailorkit init --name my-app --host http://localhost:3000/api/tailorkit --schema ./host.schema.json
tailorkit generate --cwd ./my-app --schema ../host.schema.json
```

Without `--schema`, init and generate fetch the schema from the configured host.
The snapshot provides types and bindings; remote runtime calls to a local host
still require network connectivity.
