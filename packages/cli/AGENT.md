# App agent terminal

Run `tailor agent` (or `tailorkit agent`) with your host's TailorKit API URL:

```sh
tailorkit agent --host http://localhost:3000/api/tailorkit
```

The command works from any directory and does not read or write
`tailorkit.config.ts`. Missing credentials start the host's browser login approval
flow. After approval, select an existing app or create a new one in the approved
scope. Use `--app <id>` to open an existing app directly. The command prints the
app ID so you can use it on your next launch.

`--host <url>` is required and must include your TailorKit API base path. New app
names default to "My app" and can be changed at the prompt. `--cwd` and `--config`
are not supported.
Manage credentials independently with `tailorkit login --host <url>`,
`tailorkit whoami --host <url>`, and `tailorkit logout --host <url>`.

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
