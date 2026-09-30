import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  schemaSource,
  storageDrizzleModule,
  withStorageTools,
} from "@tailorkit/app-storage/tooling";
import type { StorageProject } from "@tailorkit/app-storage/tooling";
import type { StoreDefinition } from "@tailorkit/app-storage/server";
import type { LoadedTailorKitConfig } from "../config/loader";

export function storagePaths(loaded: LoadedTailorKitConfig) {
  const directory = path.join(loaded.root, ".tailorkit-storage");
  const output = path.resolve(loaded.root, loaded.config.build?.outDir ?? ".tailorkit");
  if (directory === output || !path.relative(output, directory).startsWith("..")) {
    throw new Error(
      "The app build output must not contain .tailorkit-storage (persistent local data)",
    );
  }
  return { directory, state: path.join(directory, "state") };
}
export function storageProject(loaded: LoadedTailorKitConfig): StorageProject {
  const config = loaded.config.storage;
  if (!config || !loaded.config.appId) {
    throw new Error("Storage requires a configured adapter and a stable appId");
  }
  return { ...config, ...storagePaths(loaded), root: loaded.root, appId: loaded.config.appId };
}
export function inspectStorage(loaded: LoadedTailorKitConfig): Promise<StoreDefinition> {
  const project = storageProject(loaded);
  const adapter = loaded.config.storage?.adapter;
  if (!adapter) {
    throw new Error("Configure a storage adapter first");
  }
  return withStorageTools(adapter, loaded.root, (tools) => tools.inspect(project));
}
export async function generateStorageModel(
  loaded: LoadedTailorKitConfig,
): Promise<{ store: StoreDefinition; schemaFile: string; migrations: string }> {
  const project = storageProject(loaded);
  const store = await inspectStorage(loaded);
  await mkdir(project.directory, { recursive: true });
  const file = path.join(project.directory, "drizzle-schema.mjs");
  const model = schemaSource(store).replace(
    '"drizzle-orm/sqlite-core"',
    JSON.stringify(storageDrizzleModule()),
  );
  if ((await readFile(file, "utf-8").catch(() => "")) !== model) {
    await writeFile(file, model);
  }
  return { store, schemaFile: file, migrations: path.resolve(loaded.root, project.migrations) };
}
export function buildStorage(loaded: LoadedTailorKitConfig, watch = false) {
  if (!loaded.config.storage) {
    return;
  }
  const project = storageProject(loaded);
  return withStorageTools(loaded.config.storage.adapter, loaded.root, (tools) =>
    tools.build(project, watch),
  );
}
export async function startStorageRuntime(loaded: LoadedTailorKitConfig) {
  if (!loaded.config.storage) {
    return { close: () => {} };
  }
  const project = storageProject(loaded);
  return withStorageTools(loaded.config.storage.adapter, loaded.root, (tools) =>
    tools.start(project),
  );
}
