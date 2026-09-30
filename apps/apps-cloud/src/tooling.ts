/** Cloudflare build, isolated inspection and local Wrangler execution. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import { build as viteBuild } from "vite";
import {
  assertGeneratedSchema,
  readMigrations,
  writeReferences,
  StorageTools,
} from "@tailorkit/app-storage/tooling";
import type { StorageProject } from "@tailorkit/app-storage/tooling";
import type { StoreDefinition } from "@tailorkit/app-storage/server";
import { inspectIsolated } from "./inspect.ts";

export function wranglerBinary(): string {
  const require = createRequire(import.meta.url);
  for (const directory of require.resolve.paths("wrangler") ?? []) {
    const binary = path.join(directory, "wrangler/bin/wrangler.js");
    if (existsSync(binary)) {
      return binary;
    }
  }
  throw new Error("Missing pinned Cloudflare Wrangler tool");
}
function cloudPaths(project: StorageProject) {
  return { directory: project.directory, definition: path.join(project.directory, "definition") };
}
async function writeChanged(file: string, content: string) {
  if ((await readFile(file, "utf-8").catch(() => "")) !== content) {
    await writeFile(file, content);
  }
}
async function prepareFacet(loaded: StorageProject) {
  const config = loaded;
  const paths = cloudPaths(loaded);
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
import { createStorageFacet } from ${JSON.stringify(fileURLToPath(new URL("./facet.ts", import.meta.url)))};
import { describeStore } from "@tailorkit/app-storage/runtime";
import migrations from "./migrations.json";
export class AppFacet extends createStorageFacet(store, migrations) {}
export default { fetch: () => Response.json(describeStore(store)) };
`,
  );
  return { paths, config, entry };
}
export async function inspectStorage(loaded: StorageProject): Promise<StoreDefinition> {
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
export async function buildStorage(loaded: StorageProject, watch = false) {
  const appId = loaded.appId ?? "";
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
    // The uploaded bundle contains app code only. Migration histories remain local.
    const serverEntry = path.join(paths.directory, "server-entry.ts");
    await writeChanged(
      serverEntry,
      `import store from ${JSON.stringify(path.resolve(loaded.root, config.entry))};
import { createStorageFacet } from ${JSON.stringify(fileURLToPath(new URL("./facet.ts", import.meta.url)))};
export class AppFacet extends createStorageFacet(store, []) {};
`,
    );
    await viteBuild({
      configFile: false,
      root: loaded.root,
      build: {
        ssr: serverEntry,
        outDir: path.join(paths.directory, "server-build"),
        emptyOutDir: true,
        target: "esnext",
        minify: false,
        rollupOptions: {
          external: ["cloudflare:workers"],
          output: { entryFileNames: "server.js" },
        },
      },
      ssr: { target: "webworker", noExternal: true },
    });
    await writeChanged(
      path.join(paths.directory, "server.js"),
      await readFile(path.join(paths.directory, "server-build", "server.js"), "utf-8"),
    );
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
          appId: loaded.appId,
          namespace: config.namespace,
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
          name: config.namespace,
          main: fileURLToPath(new URL("./dev.ts", import.meta.url)),
          // Wrangler resolves aliases from its project root, even with --config elsewhere.
          alias: { "app-storage-artifact": path.join(paths.directory, "artifact.json") },
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
  if (result && typeof result === "object" && "close" in result) {
    return { close: () => (result as { close(): Promise<void> }).close() };
  }
}

async function start(project: StorageProject) {
  const child = spawn(
    process.execPath,
    [
      wranglerBinary(),
      "dev",
      "--local",
      "--config",
      path.join(project.directory, "wrangler.json"),
      "--persist-to",
      project.state,
      "--port",
      String(project.port),
    ],
    { cwd: project.root, stdio: "inherit" },
  );
  const close = () => {
    child.kill("SIGTERM");
  };
  let failure: Error | undefined;
  child.once("error", (error) => {
    failure = error;
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (failure || child.exitCode !== null) {
      throw failure ?? new Error("Local Cloudflare runtime exited during startup");
    }
    try {
      const response = await fetch(`http://localhost:${project.port}/_tailorkit/storage`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok && ((await response.json()) as { appId?: string }).appId === project.appId) {
        return { close };
      }
    } catch {
      /* Wait for Wrangler's local listener. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  close();
  throw new Error("Timed out starting the local Cloudflare runtime");
}
function attempt<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });
}
// The CLI and builder depend on this service contract, not on Wrangler or Durable Object APIs.
export default Layer.succeed(StorageTools, {
  inspect: (project) => attempt(() => inspectStorage(project)),
  build: (project, watch) => attempt(() => buildStorage(project, watch)),
  start: (project) => attempt(() => start(project)),
});
