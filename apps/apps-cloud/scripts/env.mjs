import { readFile, writeFile } from "node:fs/promises";

const generated = await readFile(new URL("../src/worker-env.d.ts", import.meta.url), "utf-8");
const bindings = generated
  .match(/interface __BaseEnv_CloudStorageEnvironment \{([\s\S]*?)\n\}/u)[1]
  .replace(/DurableObjectNamespace<[^;]+>/u, "DurableObjectNamespace")
  .replaceAll("\t", "  ");
await writeFile(
  new URL("../src/env.ts", import.meta.url),
  `// Generated from wrangler.jsonc by scripts/env.mjs.\nexport interface StorageEnvironment {${bindings}\n}\n`,
);
