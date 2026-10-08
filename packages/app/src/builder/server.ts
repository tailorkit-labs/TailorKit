import { mkdir, mkdtemp, writeFile, cp, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import type { LoadedTailorKitConfig } from "../config/loader";
import { readAppMigrations } from "./migrations";
import { runtimeManifest } from "../server/bundle";
import { checkAppSchema } from "./schema-check";
import { appDatabasePaths } from "./database-paths";
import { instanceServerBindings, instanceServerImports, instanceServerPlugin } from "./instances";
import type { InstanceModule, InstanceRegistration } from "./instances";

/** Bundle the private app backend and migrations. */
export async function buildServer(
  loaded: LoadedTailorKitConfig,
  watch = false,
  buildOutDir?: string,
  instances: InstanceModule[] = [],
  registrations: InstanceRegistration[] = [],
) {
  const config = loaded.config.server;
  if (!config) {
    return;
  }
  const output =
    buildOutDir ?? path.resolve(loaded.root, loaded.config.build?.outDir ?? ".tailorkit");
  const directory = path.join(output, "server");
  const migrationsDirectory = appDatabasePaths(loaded.root, config.migrations).migrations;
  const migrationsOutput = path.join(output, "migrations");
  const temporaryRoot = path.join(output, "tmp");
  validateServerBuildOutput(loaded, output);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, "server-"));
  const entry = path.join(temporary, "entry.mjs");
  let watching = false;
  let ready: (() => void) | undefined;
  const initialBuild = watch
    ? new Promise<void>((resolve) => {
        ready = resolve;
      })
    : undefined;
  try {
    await writeFile(
      entry,
      `${
        instances.length
          ? `import app from ${JSON.stringify(path.resolve(loaded.root, config.entry ?? "src/server.ts"))};\nimport { withInstanceResolvers } from "tailorkit/server";\n${instanceServerImports(instances)}\nexport default withInstanceResolvers(app, ${instanceServerBindings(instances, registrations)});`
          : `export { default } from ${JSON.stringify(path.resolve(loaded.root, config.entry ?? "src/server.ts"))};`
      }
export { default as migrations } from "tailorkit:migrations";
export const runtimeManifest = ${JSON.stringify(runtimeManifest)};
`,
    );
    const result = await build({
      root: loaded.root,
      configFile: false,
      plugins: [
        instanceServerPlugin(loaded.root, instances),
        {
          name: "tailorkit-app-migrations",
          closeWatcher: () => rm(temporary, { recursive: true, force: true }),
          resolveId(id) {
            if (id === "tailorkit:migrations") {
              return "\0tailorkit:migrations";
            }
          },
          async load(id) {
            if (id !== "\0tailorkit:migrations") {
              return;
            }
            const { migrations, files } = await readAppMigrations(
              migrationsDirectory,
              config.migrations === undefined,
            );
            await checkAppSchema(loaded.root, migrationsDirectory);
            this.addWatchFile(appDatabasePaths(loaded.root).schema);
            for (const file of files) {
              this.addWatchFile(file);
            }
            await rm(migrationsOutput, { recursive: true, force: true });
            await mkdir(migrationsOutput, { recursive: true });
            await cp(migrationsDirectory, migrationsOutput, { recursive: true }).catch(
              (error: unknown) => {
                if (
                  config.migrations === undefined &&
                  (error as NodeJS.ErrnoException).code === "ENOENT"
                ) {
                  return;
                }
                throw error;
              },
            );
            return `export default ${JSON.stringify(migrations)};`;
          },
        },
      ],
      build: {
        ssr: entry,
        outDir: directory,
        emptyOutDir: false,
        target: "es2022",
        watch: watch ? {} : null,
        minify: "oxc",
        rollupOptions: {
          external: [],
          output: {
            entryFileNames: "server.js",
            inlineDynamicImports: true,
            minify: true,
            minifyInternalExports: true,
          },
        },
      },
      ssr: { noExternal: true },
    });
    watching = watch;
    if (watch && "on" in result && initialBuild) {
      try {
        await Promise.race([
          initialBuild,
          new Promise<never>((_, reject) =>
            result.on("event", (event) => {
              if (event.code === "ERROR") reject(event.error);
              if (event.code === "END") ready?.();
            }),
          ),
        ]);
      } catch (error) {
        await result.close();
        throw error;
      }
    }
    return result;
  } finally {
    if (!watching) await rm(temporary, { recursive: true, force: true });
  }
}

/** Check before either build can empty an output directory. */
export function validateServerBuildOutput(loaded: LoadedTailorKitConfig, output: string) {
  if (!loaded.config.server) return;
  const migrationsDirectory = appDatabasePaths(
    loaded.root,
    loaded.config.server.migrations,
  ).migrations;
  for (const name of ["server", "client", "migrations", "tmp"]) {
    if (overlaps(migrationsDirectory, path.join(output, name))) {
      throw new Error("App build output must not overlap migration source");
    }
  }
}

function overlaps(source: string, destination: string) {
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === "" ||
      (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
    );
  };
  return contains(source, destination) || contains(destination, source);
}
