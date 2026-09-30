---
"@tailorkit/core": minor
"@tailorkit/client-platform": minor
---

Upgrade oRPC to 2.0.0-beta.40. Preserve the existing TailorKit HTTP endpoint paths and actions.call client API, and migrate preview WebSocket transport to the v2 protocol. The RPC wire format is incompatible with oRPC v1: upgrade and deploy TailorKit host servers, browser clients, and CLI clients together.
