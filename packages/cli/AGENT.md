# Builder agent

Run `tailorkit agent` from an app directory with `host` configured in
`tailorkit.config.ts`. The usual `--config` and `--cwd` options also work. If you
are not logged in, the command starts the existing host approval flow.

The terminal interface uses `@ai-sdk/tui` and runs directly on Node 24.
Type a message and press Enter. Responses render as streamed markdown; tool
cards stay collapsed and reasoning is hidden. Use Esc or Ctrl+C to leave.
Up/Down and PageUp/PageDown scroll; Ctrl+L repaints the screen.
Each launch creates a fresh session, with no list, save, or resume command.

The CLI talks to the configured host's core server routes. The host verifies
the CLI token and uses its project key to call the platform. The platform
verifies the same token, derives a workspace name from the project, token, and
local session ID, and runs the BUSL-licensed `@tailorkit/builder-agent` in a session-specific sandbox.
Only public transport types and the generated API client ship with the CLI.

Streaming uses the [oRPC AI SDK integration](https://orpc.dev/docs/integrations/ai-sdk):
Workflow converts model parts to standard `UIMessageChunk` values, and oRPC carries
the chunks through the platform and host. A small `ChatTransport` converts the
oRPC iterator with `asyncIteratorToUnproxiedDataStream`. `runAgentTUI` owns input,
message history, stream assembly, rendering, and cancellation. SDK validation
checks the chunks; the OpenAPI stream describes their extensible SDK format.

The platform needs its existing database and `AUTH_SECRET`,
plus AI Gateway credentials (`AI_GATEWAY_API_KEY` or Vercel OIDC) and Vercel
Sandbox credentials. `BUILDER_AGENT_MODEL` optionally overrides the default
Gateway model (`anthropic/claude-sonnet-5.5`). The web server enables
`workflow/vite`, scanning the built builder-agent package; build dependencies
before starting the web server, as the existing Turbo tasks do.

Chat uses a single `POST /agent/chat` platform endpoint, generated into the
platform SDK with Hey API and relayed by the core host's `agent.chat` procedure.
Each launch creates a local session ID; the SDK terminal UI keeps complete
`UIMessage[]` history in memory and sends it with every turn through the transport.
There are no agent start/close endpoints,
KV session records, or previous-run lookups. Each workflow converts the UI
messages to model messages before running the builder.

A named sandbox resumes the same workspace on follow-up turns. Compute stops
after each completed turn, with a ten-minute timeout bounding active work.
Only the latest snapshot is kept, and snapshots expire after one day (Vercel's
minimum). Exiting the CLI disconnects its response and discards local history.
The durable workflow continues independently and owns sandbox cleanup, including
stopping compute after errors. Its output stream closes after cleanup; setup
failures emit a brief error before closing. Stopped workspace snapshots expire.
Workflow execution logs follow the configured backend's retention policy.

Verification:

```sh
pnpm --filter @tailorkit/cli test
pnpm --filter @tailorkit/core test
pnpm --filter @tailorkit/api-platform test
```
