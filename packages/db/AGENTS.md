# Database schema relations

- Define all Drizzle relations, including Better Auth relations, in `src/relations.ts`.
- Keep `src/schema/auth.generated.ts` limited to generated table definitions. Do not add or restore relation definitions there; the auth generator strips its generated relations after generation.
- If Better Auth relations change, update `src/relations.ts` and regenerate the auth table schema with `pnpm --filter @tailorkit/auth generate` when its tables or fields change.
