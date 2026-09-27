# Database schema relations

- Keep app-specific Drizzle relations in `src/relations.ts`.
- Keep Better Auth's generated relations in `src/schema/auth.generated.ts` and compose them into the shared config in `src/relations.ts` with `defineRelationsPart`; spread the main relations first, then relation parts.
- If a relation part overlaps an existing table entry, ensure the later part preserves any relations already defined for that table.
- After changing Better Auth plugins or schema fields, run `pnpm --filter @tailorkit/auth generate` so the generated tables and relations stay in sync.
