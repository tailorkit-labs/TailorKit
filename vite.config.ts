import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [".agents/skills", ".claude/skills", "routeTree.gen.ts"],
  },
  staged: {
    "*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}": "vp check --fix",
    "*.{json,jsonc,json5,md,mdx,yaml,yml,css,html}": "vp fmt",
  },
});
