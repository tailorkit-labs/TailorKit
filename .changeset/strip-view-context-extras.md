---
"@tailorkit/core": patch
"@tailorkit/client-core": patch
---

Silently strip undeclared fields from closed view context objects before publishing context to apps. Preserve declared-field validation and explicitly allowed arbitrary keys, and reprocess supplied context when metadata arrives or changes.
