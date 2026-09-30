# Verify and hand off

## Run applicable local checks

Inspect scripts and lifecycle hooks before executing them. Use installed tools
and the existing package manager; do not fetch a new framework for a small edit.
Do not run a script that deploys, uploads, logs in, or mutates remote state.

For the pnpm scaffold, after installing missing dependencies:

```sh
pnpm exec tsc --noEmit
pnpm run check
pnpm run build
```

Use the actual project's equivalents when scripts differ. The scaffold's `check`
covers lint/formatting; its Vite bundle build does not check TypeScript. Inspect
the successful output. Fix failures caused by the changes; report unresolved or
pre-existing failures accurately.

## Check the changed behavior

| Change       | Useful cases                                                       |
| ------------ | ------------------------------------------------------------------ |
| List/filter  | No items, no matches, reorder/removal, long text, stable selection |
| Editor       | Invalid input, Save, Cancel, failed Save retains draft             |
| Async read   | Loading, success, failure, late response after record change       |
| Write        | Duplicate submission, denied access, ambiguous failure             |
| Persistence  | Reload reads saved data, not a local array                         |
| Host view/UI | Supported slot/path, callback values, labels, narrow layout        |

Run relevant existing tests. Add focused tests for meaningful state transitions
or domain logic when needed; do not add tests that merely repeat the implementation.
Mocks establish app behavior, not real CORS, authentication, or persistence.

If an already configured host preview is available and the user requests it,
exercise the real view and integration there. CLI preview transfers code and can
require an earlier deployment. Do not deploy or login to unlock it. Local
HTML rendering is not equivalent to the host's sandbox.

## Diagnose and finish

Distinguish types/build success from host runtime evidence. Explain missing host
capabilities with a concrete administrator action rather than weakening types,
patching generated files, or pretending an operation succeeded.

Leave source, lockfiles, and build artifacts in `/workspace/app`. Report the
outcome, checks actually run and their results, and concrete limitations. Do not
say “everything works” based only on a bundle. End the loop once the requested
work and available checks are complete; publishing is not connected.

## Find the failing boundary

| Symptom                                       | Inspect                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| Import or prop type error                     | Generated bindings, installed public exports, stale schema                |
| Empty host view                               | Slot/path registration, ready/loading/error state, component availability |
| Callback expects `event.target` but gets data | Declared signature and actual forwarded arguments                         |
| Styling has no effect                         | Exposed prop/token and host renderer behavior                             |
| Build passes but action fails                 | Generated URL, opaque-origin CORS, authentication, authorization          |
| Network error looks like no records           | Response/error handling; failure is not an empty dataset                  |
| Draft moves to another row                    | Stable keys, state ownership, record identity                             |
| Older request overwrites newer data           | Effect cleanup, request identity, stale result guard                      |
| Save disappears after reload                  | Durable integration and confirmed write                                   |
| Preview requires initial deployment/login     | Finish local checks and report runtime verification pending               |

Generated signatures establish the available types, not a working integration.
A local bundle establishes bundling, not type safety or host rendering. A mock
establishes the tested transitions, not live transport. Report each accurately.

If the host or SDK is responsible, record the operation, relevant URL/path,
observed failure, and smallest needed fix. Keep secrets out of reports. Ask the
host UI administrator to expose the needed component, data, action, or access;
do not change host code or sandbox security from the app workspace.
