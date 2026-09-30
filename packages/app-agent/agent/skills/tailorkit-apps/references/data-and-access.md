# Data and access

| Need                                     | Supported owner                           |
| ---------------------------------------- | ----------------------------------------- |
| Current page or record                   | Registered view context                   |
| Draft, selection, filter, expanded state | Local Preact state                        |
| Saved records or preferences             | Verified host action or supported backend |
| Secrets or privileged work               | Trusted host/backend integration          |
| Public service lookup                    | Direct HTTPS or secure WebSocket (`wss:`) |

Local state disappears when the iframe is replaced or reloaded. Do not label
updating a local array as a durable save. Use real supplied data; clearly label
sample data only when the user requests a prototype.

## Actions and requests

Use generated public action wrappers and inspect their input/output types.
Show pending feedback, await the result, preserve drafts on failure, and confirm
success only after the operation completes. Prevent duplicate submissions; do
not blindly retry a non-idempotent write after an ambiguous network result.

Types are not permission grants or proof of transport. Current generated action
wrappers can use relative fetch URLs, which require host-runtime verification
in the opaque-origin iframe. URL resolution, CORS, and authentication may fail
even when TypeScript passes. Do not patch generated transport, construct a private
bridge, or copy host credentials into client code. Host authorization determines
tenant/record access; hiding a button cannot enforce it.

The sandbox permits direct `fetch` to absolute `https:` URLs and direct
`WebSocket` connections to `wss:` URLs; no network bridge is required. Insecure
`http:` and `ws:` connections are blocked. The iframe retains an opaque origin,
so HTTP services must support CORS for that origin (sent as `Origin: null`) and
any required preflight. WebSocket services must accept the handshake origin.
Do not assume host sessions carry over. Check status codes and response shapes;
distinguish network/CORS failure from an empty result.
`mode: "no-cors"` cannot make a response readable. Keep secret API keys and tokens
out of source, props, logs, and fixtures. Authenticated integrations need a
supported secure path; do not add an API-key collection form without one.

## Explain a missing capability

Use the user's task and the smallest required host addition:

> This host UI does not expose saved notes yet. An administrator needs to enable
> reading and saving notes for the current customer. I can build the supported
> layout, but notes will not persist until that access is available.

Name the missing component, context field, action, or access as appropriate.
Keep product messages brief and actionable. Put reproduction details in the
developer handoff. Do not claim the whole app is blocked if independent work can
be completed, or promise an unsupported button will request access.
