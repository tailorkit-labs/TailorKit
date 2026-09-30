import path from "node:path";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { validateLogoAsset } from "@tailorkit/asset-delivery/logo-validation";
import type { LogoContentType } from "@tailorkit/asset-delivery/logo-validation";
import { build as viteBuild } from "vite";
import { loadTailorKitConfig } from "../config/loader";
import { assertSupportedPreactVersion } from "../preact-version";
import { buildStorage, storagePaths } from "./storage";

import { createTailorKitUploadManifest } from "./upload-manifest";

export {
  buildStorage,
  inspectStorage,
  generateStorageModel,
  storagePaths,
  storageProject,
  startStorageRuntime,
} from "./storage";

export {
  createTailorKitUploadManifest,
  tailorkitUploadManifestSchema,
  type TailorKitUploadManifest,
} from "./upload-manifest";

const preactPackageJson = "preact/package.json";
const preactPackageJsonModuleId = "\0tailorkit-preact-package-json";

export interface BuildAppOptions {
  configPath?: string;
  cwd?: string;
  entry?: string;
  mode?: string;
  outDir?: string;
  watch?: boolean;
}

// Keep the request/build lifecycle and its failure paths together.
// eslint-disable-next-line complexity
export const buildApp = async (options: BuildAppOptions = {}): Promise<unknown> => {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  const entry = options.entry ?? loaded.config.client?.entry ?? "./src/client.ts";
  const outDir = options.outDir ?? loaded.config.build?.outDir ?? ".tailorkit";
  const preactVersion = getInstalledPreactVersion(loaded.root);

  assertSupportedPreactVersion(preactVersion);

  const resolvedOutDir = path.resolve(loaded.root, outDir);
  if (loaded.config.storage) {
    const paths = storagePaths(loaded);
    if (
      paths.directory === resolvedOutDir ||
      !path.relative(resolvedOutDir, paths.directory).startsWith("..")
    ) {
      throw new Error("App build output would clear persistent storage state");
    }
  }
  const storageWatcher = await buildStorage(loaded, options.watch);
  const writeBuildExtras = async (): Promise<void> => {
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
      await writeFile(path.join(resolvedOutDir, filename), content);
      logoManifest[variant] = filename;
    }
    await writeFile(
      path.join(resolvedOutDir, "tailorkit-upload.json"),
      `${JSON.stringify(createTailorKitUploadManifest(logoManifest, Boolean(loaded.config.storage)), null, 2)}\n`,
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
  const result = await viteBuild({
    build: {
      emptyOutDir: true,
      lib: {
        entry: path.resolve(loaded.root, entry),
        fileName: "client",
        formats: ["es"],
      },
      outDir: resolvedOutDir,
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
      {
        name: "tailorkit-browser-server-boundary",
        resolveId(id, importer) {
          if (
            /^@tailorkit\/app-storage\/(?:server|auth|runtime|tooling|orchestration)$/u.test(id) ||
            /^tailorkit\/app\/storage\/(?:server|auth)$/u.test(id) ||
            (loaded.config.storage &&
              importer &&
              path.resolve(path.dirname(importer), id) ===
                path.resolve(loaded.root, loaded.config.storage.entry))
          ) {
            throw new Error(
              "Storage server implementations cannot be imported into a browser bundle. Use storage.gen.ts references.",
            );
          }
          return null;
        },
      },
      {
        name: "tailorkit-preview-build-ready",
        async closeBundle() {
          try {
            await writeBuildExtras();
            firstBuildDone?.();
          } catch (error) {
            firstBuildFailed?.(error instanceof Error ? error : new Error(String(error)));
            throw error;
          }
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
    if (storageWatcher && typeof storageWatcher === "object" && "close" in storageWatcher) {
      await (storageWatcher as { close(): Promise<void> }).close();
    }
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
      if (storageWatcher && typeof storageWatcher === "object" && "close" in storageWatcher) {
        await (storageWatcher as { close(): Promise<void> }).close();
      }
      throw error;
    }
  }

  if (
    options.watch &&
    result &&
    typeof result === "object" &&
    "close" in result &&
    storageWatcher &&
    typeof storageWatcher === "object" &&
    "close" in storageWatcher
  ) {
    const clientWatcher = result as {
      close(): Promise<void>;
      on(name: string, listener: (...args: unknown[]) => void): void;
    };
    return {
      on: clientWatcher.on.bind(clientWatcher),
      async close() {
        await clientWatcher.close();
        await (storageWatcher as { close(): Promise<void> }).close();
      },
    };
  }
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
      `TailorKit requires Preact to build an app. Install preact@^10 and try again.`,
      { cause: error },
    );
  }

  throw new Error("Unable to read the installed Preact version.");
}
