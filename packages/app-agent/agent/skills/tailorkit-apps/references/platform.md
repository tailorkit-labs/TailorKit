# Views and host UI

Generated bindings and installed public types define what this particular host
supports. Component names alone do not establish props or behavior. For example,
an input callback may receive a string or an object; it is not necessarily a DOM
event. Check the declaration before wiring it.

## Register views

In the current public API, `createView(path, { component })`
creates a view. The client registers it with `defineClient({ slots: ... })`.
Check the installed version before using that shape:

- The registration key must match the view's path.
- Both the slot and its supported paths come from the host. A path supported by
  one slot is not automatically supported by another.
- Call `view.useContext()` only inside the ready component or its descendants.
  The current SDK renders nothing while host context is loading or unavailable;
  the host owns that feedback. Handle the app's own request states inside its
  ready view using supported components.
- A slot resolves the active path, then its ancestors. A specific match replaces
  its ancestor within that slot; an explicit `false` stops fallback. Loading or
  error does not cause ancestor fallback. Do not reproduce host routing with a
  browser router.

## Compose remote UI

Local Preact functions and providers can return generated components. Only those
components render supported host UI. Do not create a new remote component with
`createRemoteComponent`, raw HTML, or private metadata to extend the contract.

Use children only where declared. Ordinary props must fit their serializable
data types; do not pass arbitrary JSX, render functions, class instances, cycles,
or DOM events through them. Declared callbacks are the supported function path.
Keep local render functions and local context inside the app.

Styling and accessibility props are also capabilities. There is no universal
Box, Flex, table, spacing scale, or CSS prop across hosts. Read the bindings for
available layout primitives and exact tokens. Do not import `@tailorkit/ui` into
the embedded app just because the host uses it internally.

If a needed component, layout option, or navigation action is absent, explain
the missing host UI capability and ask its administrator for the narrow addition.
Implement the useful portion supported by the current contract.
