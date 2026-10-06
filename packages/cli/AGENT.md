# App agent terminal

Run `tailor agent` (or `tailorkit agent`) from an app directory with `host` and
`appId` in `tailorkit.config.ts`. Use `--app <id>` to select another existing app;
`--config` and `--cwd` also work. Missing credentials start the usual host login
approval flow. An app must already exist in the platform and belong to the
approved token's scope.

The terminal uses `@ai-sdk/tui` on Node 24. It owns input, streamed responses,
tool cards, message history and cancellation. Each launch starts fresh chat
history; every turn sends that history and the same app ID. The app's code
persists independently on its Drive. Edits happen remotely at `/workspace/app`;
local source files are not uploaded or synchronized by this command.

The path is:

`AI SDK TUI → core appAgent.chat (oRPC) → generated Hey API appAgentChat →
platform POST /app-agent/chat (OpenAPI/oRPC) → appAgent workflow`.

The host verifies the CLI token and supplies its project key to the platform.
The platform verifies the token and app scope, resolves public IDs to the
canonical app UUID, converts UI messages to model messages, and starts
`@tailorkit/app-agent`. Different users working on the same app use the same
Drive. Busy Drives fail immediately; there is no queue.

Workflow model/tool parts become standard AI SDK UI chunks at the platform
boundary. oRPC relays the stream, and a small `ChatTransport` adapts its iterator
with `asyncIteratorToUnproxiedDataStream`. The response finishes after workflow
cleanup releases the Drive. Disconnecting the terminal closes HTTP streaming;
the durable workflow continues to its own timeout and cleanup.

The platform needs its usual database and `AUTH_SECRET`, AI Gateway credentials
(`AI_GATEWAY_API_KEY` or Vercel OIDC), and Vercel Sandbox credentials.
The platform hardcodes `openai/gpt-6.1-sol`. The web app re-exports
`@tailorkit/app-agent/workflows` from its `workflows/` directory for
`workflow/vite` discovery; build dependencies with `vp pack` before starting it.

After changing the platform route contract, regenerate the API and client:

```sh
pnpm --filter @tailorkit/api-platform generate:openapi
pnpm --filter @tailorkit/client-platform generate
```

There is one chat endpoint, with no start/close APIs or server chat records.
The workflow manages sandbox creation, sliding 15-minute expiry, heartbeat and
final deletion. Drive contents survive sandbox deletion, including partial edits
from a failed turn. The terminal command does not deploy the app or back up code.
