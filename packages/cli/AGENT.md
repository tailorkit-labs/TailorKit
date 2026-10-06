# Builder agent

Run `tailorkit agent` from an app directory with `host` configured in
`tailorkit.config.ts`. The usual `--config` and `--cwd` options also work. If you
are not logged in, the command starts the existing host approval flow.

OpenTUI requires Bun >=1.3 or Node >=26.4. On Node 24, this command automatically
launches through `bun` on your PATH. Other commands continue to run on Node 24.

Type a message and press Enter. Responses stream into the transcript; tool
calls display their names. Only one turn runs at a time. Use `/exit`, `/quit`,
or Ctrl+C to leave. Closing the terminal with SIGTERM also triggers cleanup.
Each launch creates a fresh session, with no list, save, or resume command.

The CLI talks to the configured host's core server routes. The host verifies
the CLI token and uses its project key to call the platform. The platform
verifies the same token, binds the session to that project and token, and runs
the BUSL-licensed `@tailorkit/builder-agent` in a session-specific sandbox.
Only public transport types and the generated API client ship with the CLI.

The platform needs its existing database, `AUTH_SECRET`, and KV configuration,
plus AI Gateway credentials (`AI_GATEWAY_API_KEY` or Vercel OIDC) and Vercel
Sandbox credentials. `BUILDER_AGENT_MODEL` optionally overrides the default
Gateway model (`anthropic/claude-sonnet-5.5`). The web server enables
`workflow/vite`, scanning the built builder-agent package; build dependencies
before starting the web server, as the existing Turbo tasks do.

Sessions expire after one hour. Explicit close or an interrupted response
removes session access, cancels active work, and deletes the sandbox. No chat
history is stored locally or in the application database. Workflow execution
logs follow the configured Workflow backend's retention policy. Abrupt process
termination cannot guarantee a close request; KV TTL and the sandbox's compute
timeout bound stale sessions.

Verification:

```sh
pnpm --filter @tailorkit/cli test
pnpm --filter @tailorkit/cli test:tui
pnpm --filter @tailorkit/core test
pnpm --filter @tailorkit/api-platform test
```
