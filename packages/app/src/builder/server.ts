import { mkdir, mkdtemp, writeFile, cp, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import type { LoadedTailorKitConfig } from "../config/loader";
import { readAppMigrations } from "./migrations";
import { runtimeManifest } from "../server/bundle";
import { checkAppSchema } from "./schema-check";

/** Bundle the private app backend and migrations. */
export async function buildServer(
  loaded: LoadedTailorKitConfig,
  watch = false,
  buildOutDir?: string,
) {
  const config = loaded.config.server;
  if (!config) {
    return;
  }
  const output =
    buildOutDir ?? path.resolve(loaded.root, loaded.config.build?.outDir ?? ".tailorkit");
  const directory = path.join(output, "server");
  const migrationsDirectory = path.resolve(loaded.root, config.migrations ?? "./migrations");
  const migrationsOutput = path.join(output, "migrations");
  const temporaryRoot = path.join(output, "tmp");
  for (const destination of [
    directory,
    path.join(output, "client"),
    migrationsOutput,
    temporaryRoot,
  ]) {
    if (overlaps(migrationsDirectory, destination)) {
      throw new Error("App build output must not overlap migration source");
    }
  }
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, "server-"));
  const entry = path.join(temporary, "entry.mjs");
  let watching = false;
  try {
    await writeFile(
      entry,
      `export { default } from ${JSON.stringify(path.resolve(loaded.root, config.entry ?? "src/server.ts"))};\nexport { default as migrations } from "tailorkit:migrations";\nexport const runtimeManifest = ${JSON.stringify(runtimeManifest)};\n`,
    );
    const result = await build({
      root: loaded.root,
      configFile: false,
      plugins: [
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
            this.addWatchFile(path.join(loaded.root, "src/schema.ts"));
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
        rollupOptions: {
          external: [],
          output: { entryFileNames: "server.js", inlineDynamicImports: true },
        },
      },
      ssr: { noExternal: true },
    });
    watching = watch;
    return result;
  } finally {
    if (!watching) {
      await rm(temporary, { recursive: true, force: true });
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
