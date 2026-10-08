import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { loadTailorKitConfig } from "../config/loader";
import { drizzleGenerateArguments } from "./drizzle";
import { checkAppSchema } from "./schema-check";
import { appDatabasePaths } from "./database-paths";

export interface GenerateAppMigrationsOptions {
  configPath?: string;
  cwd?: string;
  name?: string;
}

export async function generateAppMigrations(options: GenerateAppMigrationsOptions = {}) {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  if (!loaded.config.server) {
    throw new Error(
      "Enable server: {} in tailorkit.config.ts before generating database migrations.",
    );
  }
  const paths = appDatabasePaths(loaded.root, loaded.config.server.migrations);
  await access(paths.schema).catch((error: unknown) => {
    throw new Error(
      `Define the app database schema in ${path.relative(loaded.root, paths.schema)} before generating migrations.`,
      { cause: error },
    );
  });
  const directory = paths.migrations;
  const args = await drizzleGenerateArguments(loaded.root, directory, options.name);
  await new Promise<void>((resolve, reject) => {
    // Keep Drizzle's rename prompts available during explicit generation.
    const child = spawn(process.execPath, args, { cwd: loaded.root, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Drizzle migration generation failed (${signal ?? code}).`));
    });
  });
  await checkAppSchema(loaded.root, directory);
  return directory;
}
