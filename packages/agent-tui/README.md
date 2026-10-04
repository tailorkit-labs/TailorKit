# TailorKit agent terminal UI

`tailorkit agent` opens a small OpenTUI client for the TailorKit Eve agent
through the host app and platform API. Run it from a TailorKit project with a
configured `host` in `tailorkit.config.ts`. If the CLI is not authenticated, it
starts the same host approval login used by `tailorkit deploy`.

```sh
tailorkit agent                         # new Eve session
tailorkit agent --config other.config.ts
```

OpenTUI currently requires Bun 1.3 or newer with the repository's Node 24 CLI.
The hosted agent needs a working model connection. Local platform development
can target a separately running Eve agent with `TAILORKIT_EVE_URL` on `apps/web`.

Each launch creates a new Eve session. The CLI keeps it active across messages
until exit and stores no session state locally. The first message includes the
configured host API URL so the agent can inspect that host's app contract.

Enter sends a message. Type `/exit` or press Ctrl+C to leave; exiting does not
reset the Eve session. The transcript displays user and assistant text, streamed
reasoning when supplied, tools and results, input requests, and errors.
