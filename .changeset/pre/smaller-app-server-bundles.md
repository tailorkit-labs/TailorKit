---
"@tailorkit/app": patch
"@tailorkit/core": patch
"tailorkit": patch
---

Minify app server bundles with Oxc and allow unused core exports to be tree-shaken, keeping host routing, platform clients, and AI dependencies out of app backends that do not use them.
