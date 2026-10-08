---
"@tailorkit/react": minor
---

Replace `useViewContext`'s status union with `{ context, loading?, error? }` so query data, loading, and errors can be passed together. Keep the view path as the first argument and infer the complete context type from that path. Loading defaults to false, errors take precedence, and loading/error states omit context. Update host examples and documentation to use the new API.
