# App previews

This folder owns platform-side app previews. `../index.ts` mounts the HTTP router, and
the web app mounts the WebSocket router through `@tailorkit/api-platform/preview/ws`
and authorizes connections through `@tailorkit/api-platform/preview/ws-auth`.

| Module                        | Responsibility                                                             |
| ----------------------------- | -------------------------------------------------------------------------- |
| `routes.ts`                   | Start, replace, and stop sessions; enforce author scope and session limits |
| `grants.ts`                   | Share invitations, consent, and viewer grants                              |
| `ws-auth.ts`, `token.ts`      | Uploader credentials and expiring viewer tokens                            |
| `ws.ts`                       | Upload RPCs and viewer revision streams                                    |
| `lifecycle.ts`                | Developer heartbeats, reconnect grace, and session retirement              |
| `build-store.ts`              | Stage, verify, promote, read, and retire builds                            |
| `storage.ts`, `errors.ts`     | Effect adapter operations and typed failures                               |
| `manifest.ts`, `constants.ts` | Shared build schemas, validation, size limits, and session TTL             |
| `runtime.ts`                  | Required KV access and WebSocket URLs                                      |

## Effect boundary

`createPreviewBuildStoreEffects(kv)` exposes lazy Effect programs. Build validation
and lease conflicts fail with `PreviewBuildError`; adapter failures fail with
`PreviewStorageError`, including the operation and original cause. Operations use
named `Effect.fn` functions for tracing.

`createPreviewBuildStore(kv)` runs those programs at the Promise boundary used by
oRPC and lifecycle callers. It preserves adapter rejection causes. New Effect
callers should compose the programs directly and run them at their own boundary.
The workspace catalog pins Effect to `4.0.0-rc.117`. The root development dependency
also makes Drizzle's optional Effect peer consistent across packages, keeping the
shared database types compatible.

## Storage guarantees

Only complete builds with verified checksums advance the current pointer. Upload
ownership and revision advancement use atomic KV operations; an ended session or
a superseded upload cannot publish a build. A failed promotion can be retried with
the verified build's existing revision. Operations remain sequential and are not
automatically retried.

Cleanup and revision notifications are best effort after promotion. TTLs bound
abandoned data, and viewers poll to recover missed notifications. Database
retirement and KV cleanup remain separate, retryable steps. Tests beside these
modules cover lifecycle authorization and upload races; `packages/kv` also tests
build delivery across adapters and platform instances.
