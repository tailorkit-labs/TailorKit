---
"@tailorkit/cli": patch
"@tailorkit/client-platform": patch
"@tailorkit/core": patch
---

Send the host URL and a fresh schema snapshot with each CLI agent turn so the remote agent can scaffold and generate bindings against an undeployed local host. Add `--schema <path>` to init and generate for generation from a serialized JSON schema file. Agent workflows require a host URL and accept an optional schema; host-only runs continue fetching the schema normally.
