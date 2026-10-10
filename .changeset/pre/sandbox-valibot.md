---
"@tailorkit/sandbox": minor
---

Replace Zod with Valibot for iframe message validation to reduce the sandbox browser bundle. Preserve strict message validation, recursive remote trees, and session limits. Exported protocol schemas are now Valibot schemas; use Valibot `parse` or `safeParse` instead of Zod schema methods.
