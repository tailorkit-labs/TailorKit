---
"@tailorkit/cli": patch
---

Replace the agent command's required `--host` flag with optional `--baseUrl`. When omitted, prompt for the API base URL before login and app selection, defaulting to `http://localhost:3000/api/tailorkit`.
