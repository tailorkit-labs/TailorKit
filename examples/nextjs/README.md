# Next.js TailorKit Example

This example shows a CRM host product that exposes TailorKit views, components,
theme tokens, and tools from a Next.js App Router application.

## Run the example

From the repository root:

```sh
corepack enable
pnpm install
```

Copy the example environment file and add a project key:

```sh
cp examples/nextjs/.env.example examples/nextjs/.env.local
```

Start the local TailorKit platform and services in one terminal:

```sh
pnpm dev
```

Then start the example in another terminal:

```sh
pnpm --filter nextjs dev
```

Open `http://localhost:5020`. The TailorKit API is mounted at
`http://localhost:5020/api/tailorkit`.

## Relevant files

- `lib/tailorkit.ts` defines the server contract.
- `app/api/tailorkit/[[...path]]/route.ts` mounts the catch-all API handler.
- `lib/tailorkit-client.tsx` maps contract components to React renderers.
- `components/tailorkit-shell.tsx` loads installed apps and renders `RenderSlot`.
- `app/customers/layout.tsx` publishes route context with `useViewContext`.

The example defaults to the platform at `http://localhost:3000`. Override
`TAILORKIT_PLATFORM_BASE_URL` when needed. App asset URLs come from platform discovery.
Set `TAILORKIT_BASE_URL` to your full public handler URL when deploying; it defaults
to `http://localhost:5020/api/tailorkit`.
