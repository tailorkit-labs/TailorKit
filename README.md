<div align="center">
  <img alt="TailorKit" src="apps/web/public/brand/mark-auto.svg" height="96">
  <h1>TailorKit</h1>
  <p>Let users build the features they want with AI.</p>
  <p>
    <a href="https://tailorkit.dev/docs">Documentation</a> ·
    <a href="https://tailorkit.dev">Website</a>
  </p>
</div>

TailorKit gives your SaaS an app ecosystem with hosting, sandboxing, and
agentic builders. Customers, partners, and AI builders can extend your product
using the design system, data, and actions you choose to expose.

TailorKit is delivered as a hosted platform. The public repository contains
the SDKs, framework packages, and source code for the platform; self-hosting is
not a supported deployment model.

## Features

- **Extend your app** — Let customers add the features and workflows they need
  to the product they already use.
- **Partner integrations** — Give third parties a supported way to build and
  publish integrations for your platform.
- **Build features with AI** — Turn a plain-language idea into a working
  extension built from your product primitives.
- **Native product UI** — Render extensions with your components so every new
  feature looks and feels built in.
- **Sandboxed runtime** — Run third-party and AI-generated code away from your
  core application runtime.
- **Managed infrastructure** — Deploy extensions through TailorKit’s global
  CDN instead of maintaining hosting and asset infrastructure yourself.
- **Framework agnostic** — Use a framework-neutral extension protocol, with an
  official React adapter available today.

## How It Works

1. A host defines a TailorKit schema: scopes, components, theme tokens, and
   server actions.
2. Apps are built against that schema.
3. Host routes authenticate requests and publish named scopes and action context.
4. The host renders installed apps with `AppView`.
5. TailorKit loads app code inside an opaque-origin iframe sandbox and proxies
   declarative UI/events across the host boundary.

Apps describe UI. The host renders the real UI and keeps control of sensitive
work.

## Documentation

- [Overview](https://tailorkit.dev/docs) explains the TailorKit model and core
  terminology.
- [Installation](https://tailorkit.dev/docs/integrate/installation) walks through a host
  integration.
- [Quickstart](https://tailorkit.dev/docs/apps/quickstart) creates and previews a
  first TailorKit app.
- [Writing apps](https://tailorkit.dev/docs/apps/writing-apps) covers the app-side
  runtime and generated bindings.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, development
commands, testing, and pull request guidance. Security issues should be
reported privately using the process in [SECURITY.md](./SECURITY.md).

## License

TailorKit uses per-package licensing. Generally, the hosted platform and
server-side infrastructure use the Business Source License 1.1, while the
SDKs, framework, client libraries, and developer tooling use Apache-2.0.

For the exact license that applies to a package, see its `package.json` and
`LICENSE.md`. See [LICENSE.md](./LICENSE.md) for the repository overview.
