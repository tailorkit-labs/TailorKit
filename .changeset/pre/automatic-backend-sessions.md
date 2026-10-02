---
"@tailorkit/core": patch
"@tailorkit/client-platform": patch
---

Remove backend.resolveInstallation configuration. Backend sessions use the existing host authenticate callback and verified scopes; the platform authorizes the app, resolves its installation and published deployment, and returns its runtime URL. Installation IDs now use the canonical app ID and token subjects represent the authorized installation scope. Data stored under previous host-selected installation IDs requires a separate migration.
