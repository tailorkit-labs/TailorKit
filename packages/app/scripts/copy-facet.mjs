import { copyFile } from "node:fs/promises";

// Ship the provider bootstrap with the CLI builder; app developers need no private runtime package.
await copyFile(
  new URL("../../../apps/apps-runtime/src/facet.ts", import.meta.url),
  new URL("../dist/facet.ts", import.meta.url),
);
