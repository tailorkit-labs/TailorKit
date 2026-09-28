---
"@tailorkit/react": minor
---

Breaking change: remove the `Register` module augmentation and the unbound package-root `useView` export. Hosts that relied on the augmentation must migrate to helpers returned by `createTailorKitClient` (for example, `export const { AppView, useApps, useView } = tailorKit`) to retain schema-specific view and context validation. An old ambient declaration may still compile while providing no validation.

The client-bound helpers also check that they are rendered under the matching `<Root client={tailorKit}>`; using a helper from another client throws at runtime.
