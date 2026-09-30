/* eslint-disable no-restricted-properties */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const [key, file] = process.argv.slice(2);
if (!key || !file) throw new Error("Usage: pnpm seed <bucket/private-object-key> <server.js-file>");
const require = createRequire(import.meta.url);
const binary = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
const child = spawn(
  process.execPath,
  [
    binary,
    "r2",
    "object",
    "put",
    key,
    "--local",
    "--persist-to",
    ".tailorkit/state",
    "--file",
    path.resolve(file),
  ],
  { stdio: "inherit" },
);
const status = await new Promise((resolve) => {
  child.once("error", () => resolve(1));
  child.once("exit", resolve);
});
process.exitCode = status ?? 1;
