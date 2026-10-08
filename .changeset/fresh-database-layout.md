---
"@tailorkit/app": minor
"@tailorkit/cli": minor
"@tailorkit/sandbox": patch
"tailorkit": minor
---

Scaffold app databases in `src/db` with schema, relations and a `defineDatabase` export. Generate migrations in `src/db/migrations`, support typed synchronous Drizzle relational queries in database handlers.

Discover app views from `src/slots/<slot-name>/*.view.tsx`, with dotted filenames mapping to nested routes and optional explicit view paths. Add `defineRoute({ shellComponent })` roots and nested slot layouts with a `Route` outlet, preserving shared layout state during navigation. Init generates a root shell with `ClientProvider`.

Remove manual `defineClient` registration, `client.entry` configuration, and fallback discovery of `src/schema.ts` and root migrations. Apps use the file-based client and `src/db` database layout exclusively.

Update sandbox diagnostics to describe the generated app client instead of the removed manual client API.
