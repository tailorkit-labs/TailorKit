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

`tailorkit deploy` verifies the existing CLI login and creates and publishes the
deployment directly through the TailorKit platform. A logged-in local host does
not need to be reachable during deployment. Login still requires the host to
approve the identity and scope; issued tokens expire after 12 hours.

For headless deployments, provide `TAILORKIT_DEPLOY_TOKEN` and use
`--no-interactive` to fail instead of prompting for login, app creation, or a type
check override. `--app-id <id>` pins deployment to an existing app and never
creates a replacement. `TAILORKIT_PLATFORM_URL` overrides the default platform
API URL (`https://tailorkit.dev/api/platform`). Environment tokens are never
saved to the CLI credential store.

The app agent uses its approved login through a dedicated deploy tool after
completing and verifying app changes. Credentials are supplied only to the
deployment process, never to the model prompt or persistent workspace.
