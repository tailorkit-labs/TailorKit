import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
async function exists(value) {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await visit(filename);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const input = await readFile(filename, "utf8");
    let output = input;
    for (const match of input.matchAll(/from\s+(["'])(\.\.?\/[^"']+)\1/gu)) {
      const specifier = match[2];
      if (specifier.endsWith(".js")) continue;
      const target = path.resolve(dir, specifier);
      const replacement = (await exists(`${target}.ts`))
        ? `${specifier}.js`
        : (await exists(path.join(target, "index.ts")))
          ? `${specifier}/index.js`
          : null;
      if (!replacement) throw new Error(`Unresolved relative import ${specifier} in ${filename}`);
      output = output.replaceAll(
        `${match[1]}${specifier}${match[1]}`,
        `${match[1]}${replacement}${match[1]}`,
      );
    }
    if (output !== input) await writeFile(filename, output);
  }
}
await visit(root);
