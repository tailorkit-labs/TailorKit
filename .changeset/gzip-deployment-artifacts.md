---
"@tailorkit/cli": patch
"@tailorkit/core": patch
"@tailorkit/client-platform": patch
---

Gzip client and server deployment bundles before uploading to reduce transfer and R2 storage. Record compressed byte checksums and sizes, and support gzip deployment metadata while retaining compatibility with uncompressed deployments.

Raise the maximum client and server bundle size to 3 MiB for uploads and decoded runtime/delivery bytes.
