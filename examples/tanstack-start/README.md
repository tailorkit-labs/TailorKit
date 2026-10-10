# TanStack Start TailorKit Example

This example shows a host product that exposes TailorKit views, slots, components,
theme tokens, and tools from a TanStack Start application.

## Run the example

From the repository root:

```sh
corepack enable
pnpm install
```

Create `examples/tanstack-start/.env`:

```env
TAILORKIT_PROJECT_KEY="your-project-key"
```

Start the local TailorKit platform and services in one terminal:

```sh
pnpm dev
```

Then start the example in another terminal:

```sh
pnpm --filter tanstack-start dev
```

Open `http://localhost:5010`. The example's TailorKit API handler is available
at `http://localhost:5010/api/tailorkit`.

## Relevant files

- `src/lib/tailorkit.ts` defines the server contract.
- `src/routes/api/tailorkit.$.ts` mounts the API handler and authentication
  context.
- `src/lib/tailorkit-client.tsx` maps contract components to React renderers.
- `src/components/tailorkit-shell.tsx` loads installed apps, publishes the root
  view context with `useViewContext`, and renders the selected app in its slot.

The example defaults to the platform at `http://localhost:3000`. Set
`TAILORKIT_PLATFORM_BASE_URL` to point it at a different service. App asset URLs
come from platform discovery.
Set `TAILORKIT_BASE_URL` to your full public handler URL when deploying; it defaults
to `http://localhost:5010/api/tailorkit`.
