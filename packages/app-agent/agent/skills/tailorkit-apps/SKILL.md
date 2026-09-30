---
name: tailorkit-apps
description: Build, edit, review, or troubleshoot TailorKit apps using the current host contract, provided UI components, Preact, and supported integrations.
---

# Build and improve TailorKit apps

Create the smallest complete workflow supported by the host. Preserve existing
files, configuration, identity, and unrelated behavior. The main prompt's hard
platform rules apply throughout; references do not grant new capabilities.

## Discover the contract

1. For a new app, use `create-app` with the user's host API URL. For an existing
   app, inspect and edit its files rather than scaffolding again.
2. From `/workspace/app`, read `package.json`, the lockfile, `tailorkit.config.ts`,
   `tsconfig.json`, the client entry, and relevant views.
3. Install missing dependencies with `pnpm install`, keeping the existing lockfile.
   Preserve the pinned CLI/SDK versions. Keep `minimumReleaseAge: 4320`; only our
   `tailorkit` and `@tailorkit/*` packages are exempt. For a new third-party package,
   check registry release dates and choose a compatible version at least three
   days old. Do not disable the age policy.
4. On a fresh scaffold, run `pnpm run generate` against the configured host.
   Starter bindings contain example capabilities, not the real host schema.
   For follow-up edits, regenerate only when the contract needs refreshing.
5. Read generated bindings, normally `src/tailorkit.gen.ts`, and installed
   `tailorkit/app` public types. Identify supported slots/paths, context,
   components, props, child support, tokens, callbacks, and actions.

If generation fails, report the failed command and URL. Do not quietly rely on
the starter schema or replace working bindings. The URL must be reachable from
the selected sandbox; `localhost` there refers to the sandbox. Docker Desktop
can reach your computer at `host.docker.internal`; a remote Vercel sandbox needs
a host URL reachable from that environment.

Ask only about consequential unknowns: ambiguous placement, missing required
data, or whether an operation must persist. Finish independent supported work
when a host capability is missing and explain the smallest administrator addition.

## Read the relevant references

Before each kind of work, read its reference. These files are supporting guidance,
not separate skills; use only the ones needed for the task.

| Work                                                                             | Read                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------- |
| Add or change views, context, components, or callbacks                           | [platform.md](references/platform.md)               |
| Add or change layouts, lists, forms, feedback, or accessibility                  | [layout.md](references/layout.md)                   |
| Structure components or write state, effects, async work, or performance changes | [preact.md](references/preact.md)                   |
| Fetch or save data, connect services, or handle missing access                   | [data-and-access.md](references/data-and-access.md) |
| Verify, diagnose failures, or hand off                                           | [verification.md](references/verification.md)       |

Keep registration in the client entry and behavior in focused local Preact
components. Use the installed SDK's public API and actual bindings. Every visible
control must work; identify temporary prototypes honestly when persistence is absent.

Before finishing, read the verification reference, run applicable checks, and fix
failures caused by the changes. Leave source and build artifacts in `/workspace/app`
and report the outcome, checks, and concrete limitations. Stop after completing
the requested work and available checks; publishing is outside this flow.
