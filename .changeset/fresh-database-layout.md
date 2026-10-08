---
"@tailorkit/app": minor
"@tailorkit/cli": minor
"tailorkit": minor
---

Scaffold app databases in src/db with schema, relations and a defineDatabase export. Generate migrations in src/db/migrations, support typed synchronous Drizzle relational queries in database handlers, and keep existing app layouts compatible.

Discover app views from src/slots/<slot-name>/*.view.tsx, with dotted filenames mapping to nested routes and optional explicit view paths. Add defineRoute({ shellComponent }) roots and nested slot layouts with a Route outlet, preserving shared layout state during navigation. Init generates a root shell with ClientProvider, and existing manual client entries remain supported.
