import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const sourceDir = fileURLToPath(new URL("./src/", import.meta.url));
const aliases: Record<string, string> = {};

// Self-imports must resolve to source while a clean pack build is recreating dist.
for (const directory of ["components", "forms", "hooks", "lib"]) {
  const directoryPath = resolve(sourceDir, directory);

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;

    const moduleName = entry.name.replace(/\.tsx?$/, "");
    const sourcePath = resolve(directoryPath, entry.name);

    aliases[`@tailorkit/ui/${directory}/${moduleName}`] = sourcePath;

    if (directory === "components") {
      aliases[`@tailorkit/ui/${moduleName}`] = sourcePath;
    }
  }
}

aliases["@tailorkit/ui/form"] = resolve(sourceDir, "forms/form.tsx");
aliases["@tailorkit/ui"] = resolve(sourceDir, "index.ts");

export default defineConfig({
  pack: {
    alias: aliases,
    suppressWarnings: /semantics of the module level directive/i,
  },
});
