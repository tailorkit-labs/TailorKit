import { build } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await build({
  configFile: false,
  logLevel: "error",
  ssr: { target: "webworker", noExternal: true },
  build: {
    ssr: "src/dynamic-workers/facet.ts",
    outDir: ".generated",
    target: "es2022",
    rollupOptions: {
      external: ["cloudflare:workers", "node:async_hooks", "application.js"],
      output: { entryFileNames: "bootstrap.js" },
    },
  },
});
await mkdir(".generated", { recursive: true });
await writeFile(".generated/bootstrap.txt", await readFile(".generated/bootstrap.js"));
