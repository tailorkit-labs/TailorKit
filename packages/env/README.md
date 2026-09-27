# Environment configuration

Each app or package owns a small `src/env.ts` schema for the values it reads:

```ts
import * as z from "zod";
import { createEnv } from "@tailorkit/env";

export const env = createEnv({
  scope: "my-package",
  schema: { SERVICE_URL: z.url().optional() },
  warnings: {
    SERVICE_URL: "SERVICE_URL is not set; this package's service integration is disabled.",
  },
});
```

Use `#env` inside that package. Add a message under `warnings` for each missing
value that should be reported. Invalid values are also warnings; parsing never
prevents an app or package from loading. Keep schemas package-specific so
unrelated packages do not report or depend on each other's settings.

For local development, values can come from the package's `.env` or
`.env.local`, `apps/web/.env` or `apps/web/.env.local`, or the workspace-root
`.env` or `.env.local`. Local files are merged in that order, with `.env.local`
files taking priority over `.env`; shell and platform environment values take
priority over all files.

`packages/env` is the only code allowed to read `process.env`. Use a package's
`#env` import everywhere else. Turbo build-time environment values belong in
that package's `turbo.json`; local dotenv files that affect a build also belong
in that task's `inputs`.
