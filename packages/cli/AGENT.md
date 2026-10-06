# Builder agent

Run `tailorkit agent` from an app directory with `host` configured in
`tailorkit.config.ts`. The usual `--config` and `--cwd` options also work. If you
are not logged in, the command starts the existing host approval flow.

OpenTUI requires Bun >=1.3 or Node >=26.4. On Node 24, this command automatically
launches through `bun` on your PATH. Other commands continue to run on Node 24.

Type a message and press Enter. Responses stream into the transcript; tool
calls display their names. Only one turn runs at a time. Use `/exit`, `/quit`,
or Ctrl+C to leave. Closing the terminal with SIGTERM also aborts an active turn.
Each launch creates a fresh session, with no list, save, or resume command.

The CLI talks to the configured host's core server routes. The host verifies
the CLI token and uses its project key to call the platform. The platform
verifies the same token, derives a workspace name from the project, token, and
local session ID, and runs the BUSL-licensed `@tailorkit/builder-agent` in a session-specific sandbox.
Only public transport types and the generated API client ship with the CLI.

Streaming uses the [oRPC AI SDK integration](https://orpc.dev/docs/integrations/ai-sdk):
Workflow converts model parts to standard `UIMessageChunk` values, and oRPC carries
the chunks through the platform and host. The TUI uses
`asyncIteratorToUnproxiedDataStream` and `readUIMessageStream` to assemble message
parts, then displays just their text and tool names. SDK validation checks the
chunks; the OpenAPI stream describes their extensible SDK format.

The platform needs its existing database and `AUTH_SECRET`,
plus AI Gateway credentials (`AI_GATEWAY_API_KEY` or Vercel OIDC) and Vercel
Sandbox credentials. `BUILDER_AGENT_MODEL` optionally overrides the default
Gateway model (`anthropic/claude-sonnet-5.5`). The web server enables
`workflow/vite`, scanning the built builder-agent package; build dependencies
before starting the web server, as the existing Turbo tasks do.

Chat uses a single `POST /agent/chat` platform endpoint, generated into the
platform SDK with Hey API and relayed by the core host's `agent.chat` procedure.
The CLI creates its own session ID and keeps complete `UIMessage[]` history in
memory, sending it with every turn. There are no agent start/close endpoints,
KV session records, or previous-run lookups. Each workflow converts the UI
messages to model messages before running the builder.

A named sandbox resumes the same workspace on follow-up turns. Compute stops
after each completed turn, with a ten-minute timeout bounding active work.
Only the latest snapshot is kept, and snapshots expire after one day (Vercel's
minimum). An interrupted stream cancels its workflow and deletes its sandbox. Idle exit
simply discards the CLI conversation; its stopped workspace snapshot expires.
Workflow execution logs follow the configured backend's retention policy.

Verification:

```sh
pnpm --filter @tailorkit/cli test
pnpm --filter @tailorkit/cli test:tui
pnpm --filter @tailorkit/core test
pnpm --filter @tailorkit/api-platform test
```
