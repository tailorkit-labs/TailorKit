# TailorKit app agent with Eve

A minimal Eve app builder for comparison with the separately developed Mastra
agent. One Eve agent
scaffolds a TailorKit app, reads the host's generated bindings, implements the
prompt, and runs local checks. Follow-up prompts edit the same app.

## Run

Requires Node.js 24+, pnpm, and a supported sandbox with native process execution.
The agent uses Eve's `DefaultSandbox`: Vercel Sandbox on Vercel; elsewhere Eve
tries Docker, microsandbox, then just-bash according to host support. For local
app generation, use a running Docker daemon or a supported microsandbox setup;
just-bash cannot execute the CLI and build toolchain.
Eve prepares the selected environment with `@tailorkit/cli@latest`
and `tailorkit@beta`. Preparation records the resolved exact versions; new apps
use the SDK version installed in their image. Both the CLI installation and each
generated app enforce a three-day release age for third-party packages, with
exceptions only for our `tailorkit` and `@tailorkit/*` packages.
The first sandbox access prepares the environment and can take a few minutes.
Fresh apps pin `oxlint@1.85.0` and `oxfmt@0.70.0` to mature versions. Selecting
the beta SDK avoids the registry's legacy
`latest` alpha tag, which lacks the scaffold's `tailorkit/app` exports.
Tags are resolved when an environment template is prepared. Eve can reuse a
cached template; it does not check the registry on every turn or session.
Existing sessions keep their installed versions and app files.

From the repository root:

```sh
pnpm --filter @tailorkit/app-agent dev
```

Use `/login` in the Eve terminal UI to connect a model provider, or set
`AI_GATEWAY_API_KEY` in `packages/app-agent/.env.local`. The initial model is
`openai/gpt-6.1-sol`; change it with `/model` or edit `agent/agent.ts`.

Send a prompt including a reachable host API URL:

```text
Build a customer notes app for http://host.docker.internal:3000/api/tailorkit.
Use the customer context and the components/actions this host exposes.
Let me add and edit notes, and show useful empty and error states.
```

Use your host's actual port/path. The example above is for Docker Desktop, which
exposes your computer as `host.docker.internal`. `localhost` inside a sandbox
refers to that sandbox. A deployed Vercel sandbox needs a host API URL reachable
from its environment.
The host must be running and expose its TailorKit schema. Without a host URL the
agent asks for it; without a reachable schema it reports the blocker.

The app lives at `/workspace/app` **inside the session's selected sandbox**.
Eve persists the session and sandbox across turns while their state is available.
It is not mounted into a repository folder. When using Docker Desktop, select the
`eve-sbx-...` container and open **Files → /workspace/app** to browse its source.
To copy the result to your computer, identify the session container, then run:

```sh
docker ps -a --filter label=eve.sandbox.role=session
docker cp <container-id>:/workspace/app ./generated-app
```

Use `/reset` for a new app/session. The agent finishes with local files and build
artifacts; app publishing and host preview are not connected.

## Implementation

- `agent/agent.ts`: model selection.
- `agent/instructions.md`: TailorKit workflow and platform boundaries.
- `agent/skills/tailorkit-apps/`: one app-building skill with focused references.
- `agent/tools/create-app.ts`: one typed, non-interactive scaffold tool; preserves
  an existing app rather than overwriting it.
- `agent/sandbox/sandbox.ts`: Eve's default provider selection and CLI preparation.
- `agent/lib/package-policy.ts`: shared TailorKit-only release-age exceptions.
- `agent/channels/eve.ts`: Eve HTTP API with local development and Vercel OIDC auth.

Eve supplies the agent loop, durable sessions, context compaction, bash/file tools,
and terminal UI. No custom memory store, database, frontend, or orchestration is
required. The dev script disables Eve's default development extensions so the
app builder runs with its authored capabilities. Provider selection remains
Eve's default, so deployed Vercel environments select Vercel Sandbox.

## App-building skill

Eve discovers `agent/skills/*/SKILL.md`, advertises their descriptions, and supplies
the `load_skill` tool and routing instructions. Loading returns the skill body
without opening a sandbox; supporting references use sandbox file access.
The main prompt requires `tailorkit-apps` before building, editing, reviewing, or
troubleshooting an app. Its short workflow directs the agent to the references
needed for each task and to verification before handoff.
No manual registration, custom loader, or TypeScript skill definition is needed.
This follows Eve's [skills documentation](https://eve.dev/docs/skills) and the
matching guide bundled with the installed `eve@0.67.1` package.

The [TailorKit apps skill](agent/skills/tailorkit-apps/SKILL.md) holds the shared
workflow. Supporting files are read on demand:

| Reference                                                                    | Guidance                                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Platform](agent/skills/tailorkit-apps/references/platform.md)               | Host contract, views, context, components, callbacks                   |
| [Layout](agent/skills/tailorkit-apps/references/layout.md)                   | Reading order, grouping, lists, forms, feedback, accessibility         |
| [Preact](agent/skills/tailorkit-apps/references/preact.md)                   | Composition, state ownership, drafts, effects, async work, performance |
| [Data and access](agent/skills/tailorkit-apps/references/data-and-access.md) | Integrations, persistence, credentials, missing host capabilities      |
| [Verification](agent/skills/tailorkit-apps/references/verification.md)       | Local checks, behavior cases, troubleshooting, handoff                 |

Hard platform rules stay in the main prompt: generated host components only,
no raw HTML or DOM UI libraries, no invented capabilities or edited bindings,
and no fake persistence or access. The skill guides implementation; it does not
extend the contract. Missing capabilities get a brief explanation and the
smallest addition needed from a host UI administrator.

The guidance builds on the separately developed Mastra skills, the repository's
[Vercel composition](../../.agents/skills/vercel-composition-patterns/SKILL.md)
and [React best practices](../../.agents/skills/vercel-react-best-practices/SKILL.md),
and [Stripe's app skill](https://github.com/stripe/ai/blob/main/skills/stripe-apps/SKILL.md).
All twelve linked Stripe reference files were reviewed: documentation, discovery,
backend, UI, workflow, extension types, scripts, webhooks, authentication,
onboarding, publishing, and feedback. The portable ideas are adapted to Preact
and TailorKit's actual runtime; Stripe-specific APIs and workflow requirements
are not instructions for this agent. Preact behavior was checked against its
[hooks guide](https://preactjs.com/guide/v11/hooks/).

Contract guidance was checked against the CLI templates and generator,
`packages/app/src/index.ts`, the sandbox host/iframe code, host rendering in
`packages/react`, and the demo/example apps. In particular, current generated
action wrappers can use relative fetch URLs; types do not establish working
authentication or CORS in an opaque-origin iframe. Keep inspecting each app's
generated bindings and installed public SDK rather than maintaining a fixed
component or token catalog in these skills.

## Compare with Mastra

Use the same host schema, prompt, and model for both agents. To align Eve with
the current Mastra model, run `/model xiaomi/mimo-v2.6-pro`. Compare generated
behavior, type/lint/build results, follow-up edits, time, and token cost. Eve's
`/traces` UI and `pnpm --filter @tailorkit/app-agent exec eve traces list` expose
local runs. Framework defaults and prompts differ, so this is a practical app
generation comparison rather than a controlled framework benchmark.

| Concern          | Eve package                             | Mastra package                         |
| ---------------- | --------------------------------------- | -------------------------------------- |
| Agent loop/tools | Framework defaults + one scaffold tool  | Coding agent + workspace configuration |
| Guidance         | Main instructions + one TailorKit skill | System prompt + TailorKit skills       |
| Sessions         | Eve's local durable runtime             | Mastra memory + PostgreSQL storage     |
| Sandbox          | Eve default; Vercel on Vercel           | Docker locally, Vercel in deployment   |
| Entry point      | Eve terminal UI / HTTP API              | Mastra Studio / server                 |

## Checks and documentation

```sh
pnpm --filter @tailorkit/app-agent check-types
pnpm --filter @tailorkit/app-agent run info
pnpm --filter @tailorkit/app-agent build
```

`build` prewarms the selected environment and packages skill references; it needs
the provider's prerequisites and registry access. Build caching is disabled
because sandbox preparation produces provider state.
For compilation alone, `pnpm --filter @tailorkit/app-agent exec eve build
--skip-sandbox-prewarm` skips preparation; that output is not ready to run a sandbox.
Runtime data and credentials are ignored by Git.

Implemented from Eve's official [getting started](https://eve.dev/docs),
[tools](https://eve.dev/docs/tools), [sandboxes](https://eve.dev/docs/sandbox),
[Docker](https://eve.dev/docs/sandbox/docker),
[agent configuration](https://eve.dev/docs/agent-config),
[skills](https://eve.dev/docs/skills), and
[terminal UI](https://eve.dev/docs/guides/dev-tui) documentation, together with
the matching docs bundled in the installed `eve` package.
