---
"@tailorkit/core": minor
"@tailorkit/client-platform": minor
---

Upgrade oRPC to 2.0.0-beta.40 with native v2 routing, clients, rate limiting, tracing, and WebSocket transport. Generate OpenAPI 3.2.0 specifications and the corresponding SDK.

Breaking changes: rename the low-level action RPC from `actions.call` to `actions.execute` (HTTP path `/actions/execute`). The old action endpoint is removed. oRPC v1 clients cannot communicate with v2 servers; upgrade host servers, browser clients, and CLI clients together. REST error JSON no longer includes `status`; read the HTTP response status instead. No v1 protocol, action alias, or error-format compatibility shim is provided.
