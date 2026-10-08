import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { appDatabasePaths } from "./database-paths";

/** Use the app's Drizzle version with explicit flags; no Drizzle config file is needed. */
export async function drizzleGenerateArguments(root: string, output: string, name?: string) {
  const require = createRequire(path.join(root, "package.json"));
  for (const directory of require.resolve.paths("drizzle-kit") ?? []) {
    const cli = path.join(directory, "drizzle-kit/bin.cjs");
    if (
      await access(cli)
        .then(() => true)
        .catch(() => false)
    ) {
      return [
        "--preserve-symlinks-main",
        cli,
        "generate",
        "--dialect",
        "sqlite",
        "--schema",
        appDatabasePaths(root).schema,
        "--out",
        output,
        ...(name === undefined ? [] : ["--name", name]),
      ];
    }
  }
  throw new Error(
    "Install drizzle-kit and drizzle-orm as dev dependencies, then run tailorkit db generate.",
  );
}
