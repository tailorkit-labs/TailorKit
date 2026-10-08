import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildApp } from "../../../packages/app/dist/builder.js";

const clientsRoot = import.meta.dirname;
const demoRoot = path.resolve(clientsRoot, "..");
const destination = path.join(demoRoot, "public/tailorkit-clients");
await mkdir(destination, { recursive: true });

for (const name of ["todo", "messages"]) {
  const output = path.join(demoRoot, ".tailorkit/demo-clients", name);
  await buildApp({ cwd: path.join(clientsRoot, name), outDir: output });
  await copyFile(path.join(output, "client/client.js"), path.join(destination, `${name}.js`));
}
