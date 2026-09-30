import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build as viteBuild } from "vite";
import {
  assertGeneratedSchema,
  readMigrations,
  schemaSource,
  writeReferences,
  storageDrizzleModule,
} from "@tailorkit/app-storage/tooling";
import { inspectIsolated, writeWorkerdConfiguration } from "@tailorkit/app-storage/selfhost";
import type { StoreDefinition } from "@tailorkit/app-storage/server";
import type { LoadedTailorKitConfig } from "../config/loader";

async function writeChanged(file: string, content: string) {
  if ((await readFile(file, "utf-8").catch(() => "")) !== content) {
    await writeFile(file, content);
  }
}
export function storagePaths(loaded: LoadedTailorKitConfig) {
  const directory = path.join(loaded.root, ".tailorkit-storage");
  const output = path.resolve(loaded.root, loaded.config.build?.outDir ?? ".tailorkit");
  if (directory === output || !path.relative(output, directory).startsWith("..")) {
    throw new Error(
      "The app build output must not contain .tailorkit-storage (persistent local data)",
    );
  }
  return {
    directory,
    definition: path.join(directory, "definition"),
    runtime: path.join(directory, "runtime"),
    state: path.join(directory, "state"),
  };
}
async function prepareFacet(loaded: LoadedTailorKitConfig) {
  const config = loaded.config.storage;
  if (!config) {
    throw new Error("Configure storage in tailorkit.config.ts first");
  }
  const paths = storagePaths(loaded);
  await mkdir(paths.directory, { recursive: true });
  const migrations = await readMigrations(path.resolve(loaded.root, config.migrations)).catch(
    (error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    },
  );
  await writeChanged(path.join(paths.directory, "migrations.json"), JSON.stringify(migrations));
  const entry = path.join(paths.directory, "facet-entry.ts");
  await writeChanged(
    entry,
    `import store from ${JSON.stringify(path.resolve(loaded.root, config.entry))};
import { createStorageFacet, describeStore } from "@tailorkit/app-storage/facet";
import migrations from "./migrations.json";
export class AppFacet extends createStorageFacet(store, migrations) {}
export default { fetch: () => Response.json(describeStore(store)) };
`,
  );
  return { paths, config, entry };
}
export async function inspectStorage(loaded: LoadedTailorKitConfig): Promise<StoreDefinition> {
  const { paths, entry } = await prepareFacet(loaded);
  await viteBuild({
    configFile: false,
    root: loaded.root,
    build: {
      ssr: entry,
      outDir: paths.definition,
      emptyOutDir: true,
      minify: false,
      target: "esnext",
      rollupOptions: { external: ["cloudflare:workers"], output: { entryFileNames: "facet.js" } },
    },
    ssr: { target: "webworker", noExternal: true },
  });
  // No app implementation or validator is imported into the CLI's Node process.
  return inspectIsolated(path.join(paths.definition, "facet.js"));
}
export async function generateStorageModel(
  loaded: LoadedTailorKitConfig,
): Promise<{ store: StoreDefinition; schemaFile: string; migrations: string }> {
  if (!loaded.config.storage) {
    throw new Error("Configure storage first");
  }
  const store = await inspectStorage(loaded);
  const file = path.join(storagePaths(loaded).directory, "drizzle-schema.mjs");
  const model = schemaSource(store).replace(
    '"drizzle-orm/sqlite-core"',
    JSON.stringify(storageDrizzleModule()),
  );
  await writeChanged(file, model);
  return {
    store,
    schemaFile: file,
    migrations: path.resolve(loaded.root, loaded.config.storage.migrations),
  };
}
export async function buildStorage(loaded: LoadedTailorKitConfig, watch = false) {
  if (!loaded.config.storage) {
    return;
  }
  if (!loaded.config.appId) {
    throw new Error("Storage apps require a stable appId");
  }
  const appId = loaded.config.appId;
  const { config, paths, entry } = await prepareFacet(loaded);
  const migrationsDirectory = path.resolve(loaded.root, config.migrations);
  let resolveInitial: (() => void) | undefined;
  let rejectInitial: ((error: unknown) => void) | undefined;
  const initial = new Promise<void>((resolve, reject) => {
    resolveInitial = resolve;
    rejectInitial = reject;
  });
  void initial.catch(() => {});
  const finish = async () => {
    const codeFile = path.join(paths.definition, "facet.js");
    const store = await inspectIsolated(codeFile);
    await assertGeneratedSchema(migrationsDirectory, store);
    const references = path.resolve(loaded.root, config.references);
    await mkdir(path.dirname(references), { recursive: true });
    await writeReferences(references, path.resolve(loaded.root, config.entry), store);
    const code = await readFile(codeFile, "utf-8");
    const migrations = await readMigrations(migrationsDirectory);
    const artifact = {
      code,
      codeHash: createHash("sha256").update(code).digest("hex"),
      apiVersion: store.apiVersion,
      migrations: migrations.map(({ id, hash }) => ({ id, hash })),
    };
    await writeChanged(path.join(paths.directory, "artifact.json"), JSON.stringify(artifact));
    await writeChanged(
      path.join(paths.directory, "storage-manifest.json"),
      JSON.stringify(
        {
          protocol: 1,
          appId: loaded.config.appId,
          workerName: config.workerName,
          apiVersion: artifact.apiVersion,
          codeHash: artifact.codeHash,
          migrations: artifact.migrations,
        },
        null,
        2,
      ),
    );
    const publicKeys: unknown = JSON.parse(
      await readFile(path.resolve(loaded.root, config.publicKeys), "utf-8"),
    );
    const bindings = {
      STORAGE_APP_ID: appId,
      STORAGE_ISSUER: config.issuer,
      STORAGE_AUDIENCE: config.audience,
      STORAGE_PUBLIC_KEYS: JSON.stringify(publicKeys),
      STORAGE_ORIGINS: JSON.stringify(config.origins.map((value) => new URL(value).origin)),
    };
    await writeChanged(
      path.join(paths.directory, "wrangler.json"),
      JSON.stringify(
        {
          name: config.workerName,
          main: "runtime/worker.js",
          compatibility_date: "2026-08-27",
          workers_dev: false,
          preview_urls: false,
          worker_loaders: [{ binding: "LOADER" }],
          durable_objects: { bindings: [{ name: "STORES", class_name: "AppStorage" }] },
          migrations: [{ tag: "v1", new_sqlite_classes: ["AppStorage"] }],
          vars: bindings,
          observability: { enabled: true },
        },
        null,
        2,
      ),
    );
    const supervisor = path.join(paths.directory, "supervisor-entry.ts");
    await writeChanged(
      supervisor,
      `import artifact from "./artifact.json";
import { createStorageDurableObject, createStorageWorker } from "@tailorkit/app-storage/cloudflare";
export class AppStorage extends createStorageDurableObject(artifact) {}
export default createStorageWorker(artifact);
`,
    );
    // The trusted bundle contains the untrusted code as a string, never as a live module.
    await viteBuild({
      configFile: false,
      root: loaded.root,
      build: {
        ssr: supervisor,
        outDir: paths.runtime,
        emptyOutDir: true,
        target: "esnext",
        minify: false,
        rollupOptions: {
          external: ["cloudflare:workers"],
          output: { entryFileNames: "worker.js" },
        },
      },
      ssr: { target: "webworker", noExternal: true },
    });
    await writeWorkerdConfiguration(path.join(paths.directory, "workerd.capnp"), {
      workerFile: "runtime/worker.js",
      namespace: config.workerName,
      bindings,
      port: config.port,
    });
    const docker = path.join(paths.directory, "docker");
    await mkdir(docker, { recursive: true });
    await writeChanged(
      path.join(docker, "worker.js"),
      await readFile(path.join(paths.runtime, "worker.js"), "utf-8"),
    );
    await writeWorkerdConfiguration(path.join(docker, "workerd.capnp"), {
      workerFile: "worker.js",
      namespace: config.workerName,
      bindings,
    });
    resolveInitial?.();
  };
  const result = await viteBuild({
    configFile: false,
    root: loaded.root,
    build: {
      ssr: entry,
      outDir: paths.definition,
      emptyOutDir: true,
      target: "esnext",
      minify: false,
      watch: watch ? {} : null,
      rollupOptions: { external: ["cloudflare:workers"], output: { entryFileNames: "facet.js" } },
    },
    ssr: { target: "webworker", noExternal: true },
    plugins: [
      {
        name: "tailorkit-storage",
        async buildStart() {
          this.addWatchFile(migrationsDirectory);
          this.addWatchFile(path.resolve(loaded.root, config.publicKeys));
          if (watch) {
            await prepareFacet(loaded);
          }
        },
        async writeBundle() {
          try {
            await finish();
          } catch (error) {
            rejectInitial?.(error);
            throw error;
          }
        },
      },
    ],
  });
  if (watch && result && typeof result === "object" && "on" in result) {
    (
      result as {
        on(name: string, listener: (event: { code: string; error?: unknown }) => void): void;
      }
    ).on("event", (event) => {
      if (event.code === "ERROR") {
        rejectInitial?.(event.error ?? new Error("Storage build failed"));
      }
    });
    try {
      await initial;
    } catch (error) {
      if ("close" in result) {
        await (result as { close(): Promise<void> }).close();
      }
      throw error;
    }
  }
  return result;
}
