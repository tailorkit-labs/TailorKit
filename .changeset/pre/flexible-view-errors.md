---
"@tailorkit/client-core": minor
"@tailorkit/react": minor
"tailorkit": minor
---

Allow `useViewContext` errors to be booleans, strings, or `Error` instances. Only `false`, `null`, and `undefined` mean no error; all strings, including an empty string, mark the view as failed. Errors continue to take precedence over loading and suppress context publication.
