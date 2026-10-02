import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const require = createRequire(import.meta.url);
const preactPackageJson = require("preact/package.json") as { version: string };

export default defineConfig({
  clean: true,
  define: {
    __PREACT_VERSION__: JSON.stringify(preactPackageJson.version),
  },
  entry: {
    builder: "src/builder/index.ts",
    config: "src/config/index.ts",
    "config-loader": "src/config/loader.ts",
    index: "src/index.ts",
    client: "src/client.ts",
    server: "src/server.ts",
    protocol: "src/protocol.ts",
  },
  format: ["esm"],
  noExternal: [/^@tailorkit\/asset-delivery(?:\/|$)/u],
  target: "node20",
});
