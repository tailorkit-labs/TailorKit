import { defineConfig } from "vite-plus";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  build: {
    ssr: "src/index.ts",
    target: "node24",
    minify: false,
    rolldownOptions: {
      external: [/^node:/u, ...Object.keys(packageJson.dependencies)],
      output: {
        entryFileNames: "index.js",
      },
    },
  },
});
