# Database migrations

Generate migrations with the Drizzle CLI. Do not hand-write migration SQL unless it is absolutely necessary.

# UI components

Before adding UI, check `packages/ui` and use existing components wherever possible.
Use `cn` from `@tailorkit/ui` to compose class names; do not use template literals.

# Package release age

Install packages only after at least 3 days have passed since their release date, unless a required feature or bug fix makes an earlier update necessary.
