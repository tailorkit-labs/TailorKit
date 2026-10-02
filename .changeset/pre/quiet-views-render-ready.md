---
"@tailorkit/app": minor
---

Breaking change: remove the `loading` and `error` component options from `createView`. Apps must remove these options and provide only `component`. App views now render nothing while host context is loading or in an error state. Internal view states, readiness composition, and ready context access remain unchanged.
