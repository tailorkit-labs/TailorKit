import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "vite";
import type { LoadedTailorKitConfig } from "../config/loader";

/** Generate browser-only references without evaluating app server code in the build host. */
export async function buildServer(
  loaded: LoadedTailorKitConfig,
  watch = false,
  browserOutDir?: string,
) {
  const config = loaded.config.server;
  if (!config) return;
  const directory = path.join(loaded.root, ".tailorkit-server");
  const output =
    browserOutDir ?? path.resolve(loaded.root, loaded.config.build?.outDir ?? ".tailorkit");
  if (directory === output || !path.relative(output, directory).startsWith(".."))
    throw new Error("App build output must not clear server state");
  await mkdir(directory, { recursive: true });
  const shipped = new URL("./facet.ts", import.meta.url);
  const facet = fileURLToPath(
    await access(shipped)
      .then(() => shipped)
      .catch(() => new URL("../../../../apps/apps-runtime/src/facet.ts", import.meta.url)),
  );
  const entry = path.join(directory, "entry.mjs");
  await writeFile(
    entry,
    `import app from ${JSON.stringify(path.resolve(loaded.root, config.entry))};\nimport { createAppFacet } from ${JSON.stringify(facet)};\nexport class AppFacet extends createAppFacet(app) {}\n`,
  );
  const references = `import { reference } from "@tailorkit/apps-server/client";\nimport type { References } from "@tailorkit/apps-server/client";\nimport type app from ${JSON.stringify(relativeModule(path.dirname(path.resolve(loaded.root, config.references)), path.resolve(loaded.root, config.entry)))};\nexport const api = new Proxy(\n  {},\n  {\n    get(_target, name) {\n      return reference(String(name), "query");\n    },\n  },\n) as References<typeof app.functions>;\n`;
  // The kind is type-only for dispatch: the server enforces the actual function kind.
  const refs = path.resolve(loaded.root, config.references);
  await mkdir(path.dirname(refs), { recursive: true });
  if ((await readFile(refs, "utf8").catch(() => "")) !== references)
    await writeFile(refs, references);
  return build({
    root: loaded.root,
    configFile: false,
    build: {
      ssr: entry,
      outDir: directory,
      emptyOutDir: false,
      target: "es2022",
      watch: watch ? {} : null,
      rollupOptions: { external: ["cloudflare:workers"], output: { entryFileNames: "server.js" } },
    },
    ssr: { noExternal: true },
  });
}

function relativeModule(from: string, to: string) {
  const relative = path
    .relative(from, to)
    .replaceAll(path.sep, "/")
    .replace(/\.tsx?$/u, "");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
