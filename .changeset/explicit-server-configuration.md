---
"@tailorkit/core": minor
"tailorkit": minor
---

Require an absolute public HTTP(S) `baseUrl` when creating a server. Relative paths and omitted URLs are rejected, and backend sessions and server tool verification always use the configured public origin.

Move authentication exclusively to `.handler(request, { authenticate })` and remove the server's `assetsBaseUrl` option. Update host integrations to pass authentication on every handler call; client-side asset URL fallbacks remain available through `createClient`.
