---
"tailorkit": minor
"@tailorkit/core": minor
"@tailorkit/client-core": minor
"@tailorkit/react": minor
---

Define shared browser-safe contracts with `defineContract` and `action().input().output()`. Use `createServer` from `tailorkit/server` to implement actions and `createClient` from `tailorkit/react` to infer component, view, slot, and scope types from the same contract.

Host clients validate view context through the contract's original Standard Schema validators and publish the parsed output. Remove JSON Schema reconstruction and host `/meta` requests; resolve slots locally from the contract and accept an explicit client `assetsBaseUrl` for deployment URL fallbacks. Keep server metadata for app type generation, including scope schemas.

Migrate existing server configuration into `defineContract`, move handlers and secrets to `createServer`, and replace the server type generic on React clients with a `contract` option.

Contract actions without an input schema infer `undefined`; actions without an output schema infer `void`. Server implementations use the same contract return types, including `Promise<void>` for asynchronous handlers.

Pass Valibot's `toJsonSchema` directly as the server `schemaSerializer`. Converters receive JSON Schema 2020-12 options, with `typeMode: "input"` for action inputs and `typeMode: "output"` for action results and other metadata; existing single-argument serializers remain supported.
