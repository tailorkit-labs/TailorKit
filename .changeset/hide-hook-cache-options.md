---
"@tailorkit/react": patch
---

Remove staleTime and gcTime from useApps, useViews, and useSlotInstances options. Hooks continue to use the client's cache configuration and support explicit refetching.
