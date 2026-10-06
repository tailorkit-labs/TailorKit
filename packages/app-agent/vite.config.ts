import { readFileSync } from "node:fs";
import { defineConfig } from "vite-plus";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/workflows.ts"],
    format: "esm",
    target: "node24",
    dts: true,
    sourcemap: true,
    clean: true,
    minify: false,
    deps: { neverBundle: Object.keys(packageJson.dependencies) },
    plugins: [
      {
        name: "instructions-raw",
        load(id) {
          if (id.endsWith(".md?raw")) {
            return `export default ${JSON.stringify(readFileSync(id.slice(0, -4), "utf8"))};`;
          }
        },
      },
    ],
  },
});
