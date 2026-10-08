---
"@tailorkit/app": minor
"@tailorkit/cli": minor
"tailorkit": minor
---

Scaffold app databases in src/db with schema, relations and a defineDatabase export. Generate migrations in src/db/migrations, support typed synchronous Drizzle relational queries in database handlers, and keep existing app layouts compatible.

Generate views under src/slots/<slot-name>/<view-name>.tsx and wire the client entry to the selected slot and route. Root views use index.tsx; nested routes keep their directory structure.
