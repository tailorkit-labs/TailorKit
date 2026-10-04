# TailorKit agent terminal UI

`tailorkit agent` opens a small OpenTUI client for the TailorKit Eve agent. Start
the agent separately with `pnpm --filter @tailorkit/app-agent dev`, or use
`eve dev --no-ui` from `packages/app-agent`.

```sh
tailorkit agent                         # new Eve session
tailorkit agent --url http://127.0.0.1:2000
```

The URL defaults to `TAILORKIT_AGENT_URL` or `http://127.0.0.1:2000`. OpenTUI
currently requires Bun 1.3 or newer with the repository's Node 24 CLI. The
terminal needs a model connection configured in Eve; use Eve's `/login` flow in
its development TUI or provide a provider key to the agent process.

Each launch creates a new Eve session. The CLI keeps it active across messages
until exit and stores no session state locally.

Enter sends a message. Type `/exit` or press Ctrl+C to leave; exiting does not
reset the Eve session. The transcript displays user and assistant text, streamed
reasoning when supplied, tools and results, input requests, and errors.
