---
"@tailorkit/cli": patch
---

Require an explicit --host URL for the agent command instead of reading or writing tailorkit.config.ts. Keep --app optional for selecting an existing remote app, remove --cwd from the agent command, and support --host for login, logout, and whoami.
