import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
// An operator builds app artifacts through the TailorKit CLI, then packages the trusted service separately.
// This operator-owned build entry reads its artifact path, not application secrets.
// eslint-disable-next-line no-restricted-properties
const directory = process.env.TAILORKIT_STORAGE_ARTIFACT;
if (!directory) {
  throw new Error(
    "Set TAILORKIT_STORAGE_ARTIFACT to an app's generated .tailorkit-storage directory",
  );
}
const config = JSON.parse(await readFile(path.join(directory, "wrangler.json"), "utf-8"));
await mkdir("dist", { recursive: true });
await writeFile("dist/artifact.json", await readFile(path.join(directory, "artifact.json")));
await writeFile(
  "dist/entry.ts",
  `import artifact from "./artifact.json";
import { createStorageDurableObject, createStorageWorker } from "@tailorkit/app-storage/cloudflare";
export class AppStorage extends createStorageDurableObject(artifact) {}
export default createStorageWorker(artifact);
`,
);
await build({
  configFile: false,
  ssr: { target: "webworker", noExternal: true },
  build: {
    ssr: "dist/entry.ts",
    outDir: "dist",
    emptyOutDir: false,
    target: "esnext",
    minify: false,
    rollupOptions: { external: ["cloudflare:workers"], output: { entryFileNames: "worker.js" } },
  },
});
await writeFile("dist/wrangler.json", JSON.stringify({ ...config, main: "worker.js" }, null, 2));
