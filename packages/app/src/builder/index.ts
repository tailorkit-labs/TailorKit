import path from "node:path";
import { createRequire } from "node:module";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { validateLogoAsset } from "@tailorkit/asset-delivery/logo-validation";
import type { LogoContentType } from "@tailorkit/asset-delivery/logo-validation";
import { build as viteBuild } from "vite";
import { loadTailorKitConfig } from "../config/loader";
import { assertSupportedPreactVersion } from "../preact-version";
import { readClientManifest } from "./client-views";
import { buildServer, validateServerBuildOutput } from "./server";
import { instanceExtractionPlugin } from "./instances";
import { createFileRouteEntry, fileRoutesPlugin } from "./file-routes";
import type { InstanceModule } from "./instances";

import { createTailorKitUploadManifest } from "./upload-manifest";

export {
  createTailorKitUploadManifest,
  tailorkitUploadManifestSchema,
  type TailorKitUploadManifest,
} from "./upload-manifest";

const preactPackageJson = "preact/package.json";
const preactPackageJsonModuleId = "\0tailorkit-preact-package-json";

export { generateAppMigrations, type GenerateAppMigrationsOptions } from "./generate-migrations";
export { getClientSourceFiles } from "./file-routes";

export interface BuildAppOptions {
  configPath?: string;
  cwd?: string;
  mode?: string;
  outDir?: string;
  watch?: boolean;
}

// Keep the request/build lifecycle and its failure paths together.
// eslint-disable-next-line complexity
export const buildApp = async (options: BuildAppOptions = {}): Promise<unknown> => {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  loaded.root = await realpath(loaded.root);
  const serverEntry = path.resolve(loaded.root, loaded.config.server?.entry ?? "src/server.ts");
  const outDir = options.outDir ?? loaded.config.build?.outDir ?? ".tailorkit";
  const preactVersion = getInstalledPreactVersion(loaded.root);

  assertSupportedPreactVersion(preactVersion);

  const resolvedOutDir = path.resolve(loaded.root, outDir);
  validateServerBuildOutput(loaded, resolvedOutDir);
  const clientOutDir = path.join(resolvedOutDir, "client");
  const fileEntry = await createFileRouteEntry(loaded.root, resolvedOutDir, Boolean(options.watch));
  const entry = fileEntry.entry;
  const instanceModules = new Map<string, InstanceModule>();
  let serverWatcher: Awaited<ReturnType<typeof buildServer>>;
  const writeBuildExtras = async (): Promise<void> => {
    const { views, instanceResolvers } = await readClientManifest(
      path.join(clientOutDir, "client.js"),
    );
    const resolverNames = new Set(instanceResolvers.map((registration) => registration.resolver));
    const activeModules = [...instanceModules.values()]
      .map((module) => ({
        ...module,
        names: module.names.filter((name) => resolverNames.has(name)),
      }))
      .filter((module) => module.names.length)
      .sort((a, b) => a.filename.localeCompare(b.filename));
    if (
      activeModules.reduce((count, module) => count + module.names.length, 0) !== resolverNames.size
    ) {
      throw new Error(
        "Client references an instance resolver that was not extracted by the app build.",
      );
    }
    if (serverWatcher && "close" in serverWatcher) await serverWatcher.close();
    serverWatcher = await buildServer(
      loaded,
      options.watch,
      resolvedOutDir,
      activeModules,
      instanceResolvers,
    );
    const logoManifest: { dark?: string; light?: string } = {};
    for (const variant of ["light", "dark"] as const) {
      const configuredPath = loaded.config.logos?.[variant];
      if (!configuredPath) {
        continue;
      }
      const extension = path.extname(configuredPath).toLowerCase().slice(1);
      const contentType = { png: "image/png", svg: "image/svg+xml", webp: "image/webp" }[
        extension
      ] as LogoContentType | undefined;
      if (!contentType) {
        throw new Error(`The ${variant} logo must be an SVG, PNG, or WebP file.`);
      }
      const content = await readFile(path.resolve(loaded.root, configuredPath));
      validateLogoAsset(content, contentType);
      const filename = `logo-${variant}.${extension}`;
      await writeFile(path.join(clientOutDir, filename), content);
      logoManifest[variant] = `client/${filename}`;
    }
    await writeFile(path.join(clientOutDir, "views.json"), `${JSON.stringify(views)}\n`);
    await writeFile(
      path.join(resolvedOutDir, "tailorkit-upload.json"),
      `${JSON.stringify(createTailorKitUploadManifest(logoManifest, Boolean(loaded.config.server), views), null, 2)}\n`,
      "utf-8",
    );
  };
  let firstBuildDone: (() => void) | undefined;
  let firstBuildFailed: ((error: Error) => void) | undefined;
  const firstBuild = new Promise<void>((resolve, reject) => {
    firstBuildDone = resolve;
    firstBuildFailed = reject;
  });
  if (!options.watch) {
    void firstBuild.catch(() => {});
  }
  const completeBuild = async () => {
    try {
      await writeBuildExtras();
      firstBuildDone?.();
    } catch (error) {
      firstBuildFailed?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };
  const result = await viteBuild({
    build: {
      emptyOutDir: true,
      lib: {
        entry,
        fileName: "client",
        formats: ["es"],
      },
      outDir: clientOutDir,
      watch: options.watch ? {} : null,
      minify: "oxc",
      rollupOptions: {
        output: {
          comments: {
            annotation: false,
            jsdoc: false,
            legal: false,
          },
          minify: true,
          minifyInternalExports: true,
        },
      },
    },
    configFile: false,
    mode: options.mode,
    oxc: { jsx: { importSource: "preact" } },
    plugins: [
      fileRoutesPlugin(loaded.root),
      instanceExtractionPlugin(loaded.root, Boolean(loaded.config.server), instanceModules),
      {
        name: "tailorkit-browser-server-boundary",
        enforce: "pre",
        async resolveId(id, importer) {
          if (
            /^(?:@tailorkit\/app\/server$|tailorkit\/(?:server|app\/server)$|effect(?:\/|$))/u.test(
              id,
            ) ||
            (importer && path.resolve(path.dirname(importer), id) === serverEntry)
          ) {
            throw new Error(
              "App server implementations cannot be imported into a browser bundle. Import api from #tailorkit and server types with import type.",
            );
          }
          if (importer) {
            const resolved = await this.resolve(id, importer, { skipSelf: true });
            if (resolved?.id.split("?")[0] === serverEntry) {
              throw new Error(
                "App server implementations cannot be imported into a browser bundle. Import api from #tailorkit and server types with import type.",
              );
            }
          }
          return null;
        },
      },
      {
        name: "tailorkit-preview-build-ready",
        async writeBundle() {
          await completeBuild();
        },
      },
      {
        name: "tailorkit-preact-package-json",
        enforce: "pre",
        resolveId(id) {
          if (id === preactPackageJson) {
            return preactPackageJsonModuleId;
          }

          return null;
        },
        load(id) {
          if (id === preactPackageJsonModuleId) {
            const version = JSON.stringify(preactVersion);

            return `export const version = ${version}; export default { version: ${version} };`;
          }

          return null;
        },
      },
    ],
    root: loaded.root,
  }).catch(async (error: unknown) => {
    await fileEntry.close();
    if (serverWatcher && "close" in serverWatcher) await serverWatcher.close();
    throw error;
  });
  if (options.watch) {
    if (result && typeof result === "object" && "on" in result) {
      (
        result as {
          on: (name: string, listener: (event: { code: string; error?: Error }) => void) => void;
        }
      ).on("event", (event) => {
        if (event.code === "ERROR") {
          firstBuildFailed?.(event.error ?? new Error("Initial app build failed."));
        }
      });
    }
    try {
      await firstBuild;
    } catch (error) {
      if (result && typeof result === "object" && "close" in result) {
        await (result as { close(): Promise<void> }).close();
      }
      if (serverWatcher && "close" in serverWatcher) await serverWatcher.close();
      await fileEntry.close();
      throw error;
    }
    if (result && "close" in result) {
      const clientWatcher = result as {
        close(): Promise<void>;
        on(name: string, listener: (...args: unknown[]) => void): void;
      };
      return {
        on: clientWatcher.on.bind(clientWatcher),
        async close() {
          await clientWatcher.close();
          if (serverWatcher && "close" in serverWatcher) await serverWatcher.close();
          await fileEntry.close();
        },
      };
    }
  }

  await fileEntry.close();

  return result;
};

function getInstalledPreactVersion(root: string): string {
  const require = createRequire(path.join(root, "package.json"));

  try {
    const packageJsonPath = require.resolve("preact/package.json");
    const packageJson = require(packageJsonPath) as { version?: unknown };

    if (typeof packageJson.version === "string") {
      return packageJson.version;
    }
  } catch (error) {
    throw new Error(
      `TailorKit requires Preact to build an app. Install preact@^11 and try again.`,
      { cause: error },
    );
  }

  throw new Error("Unable to read the installed Preact version.");
}
