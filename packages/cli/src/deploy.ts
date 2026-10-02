import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { TailorKitUploadManifest } from "@tailorkit/app/builder";
import type { LoadedTailorKitConfig } from "@tailorkit/app/config/loader";
import { loadTailorKitConfig } from "@tailorkit/app/config/loader";
import { createTailorKitClient } from "@tailorkit/core/server";
import type { z } from "zod";
import { getDeployToken, NotLoggedInError, runWhoami } from "./auth";

export interface TypecheckFailure {
  command: string;
  exitCode: number | null;
  output: string;
}

interface DeployOptions {
  configPath?: string;
  cwd: string;
  mode?: string;
  onLoginRequired?: () => Promise<{ hostUrl: string }>;
  onMissingAppId?: (details: {
    appName: string;
    configPath: string;
    hostUrl: string;
    reason: "missing" | "not-found";
  }) => Promise<boolean>;
  onTypecheckFailed?: (failure: TypecheckFailure) => Promise<boolean>;
  outDir?: string;
}

interface DeploymentAssetUpload {
  headers?: Record<string, string>;
  uploadUrl: string;
}

interface DeploymentLogoUpload {
  headers?: Record<string, string>;
  uploadUrl?: string;
}

interface DeploymentCreateResult {
  assets: DeploymentAssetUpload[];
  server?: DeploymentAssetUpload;
  deployment: {
    id: string;
  };
  logos?: {
    dark?: DeploymentLogoUpload;
    light?: DeploymentLogoUpload;
  };
}

interface DeploymentPublishResult {
  id: string;
  status?: string;
}

interface AppCreateResult {
  id: string;
}

export interface DeployResult {
  appId: string;
  createdApp: boolean;
  deploymentId: string;
  hostUrl: string;
  status?: string;
  uploadedFiles: UploadedFileSummary[];
}

interface UploadedFileSummary {
  gzipSize: number;
  path: string;
  size: number;
}

const maxDeploymentBytes = 1024 * 1024;
const gzipAsync = promisify(gzip);
const logoContentTypeByExtension: Record<string, "image/png" | "image/svg+xml" | "image/webp"> = {
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const unwrapRpcResult = <T>(result: unknown): T => {
  if (result && typeof result === "object" && "error" in result && result.error !== undefined) {
    throw result.error;
  }

  const data = result && typeof result === "object" && "data" in result ? result.data : result;
  const body = data && typeof data === "object" && "body" in data ? data.body : data;

  return body as T;
};

const getErrorMessage = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
};

const isNotFoundError = (error: unknown): boolean =>
  getErrorMessage(error)?.toLowerCase().includes("not found") ?? false;

const readUploadManifest = async (
  outDir: string,
  schema: z.ZodType<TailorKitUploadManifest>,
): Promise<TailorKitUploadManifest> => {
  const manifestPath = path.join(outDir, "tailorkit-upload.json");
  return schema.parse(JSON.parse(await readFile(manifestPath, "utf-8")));
};

const sha256Hex = (content: Buffer): string => createHash("sha256").update(content).digest("hex");

const readAppName = async (root: string): Promise<string> => {
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf-8")) as {
      name?: unknown;
    };

    if (typeof packageJson.name === "string" && packageJson.name.trim()) {
      return packageJson.name.trim();
    }
  } catch {
    // Fall back to the directory name when package metadata is unavailable.
  }

  return path.basename(root);
};

const writeAppIdToConfig = async (configPath: string, appId: string): Promise<void> => {
  const source = await readFile(configPath, "utf-8");
  const appIdLine = `  appId: ${JSON.stringify(appId)},`;

  if (/^\s*appId\s*:/mu.test(source)) {
    await writeFile(
      configPath,
      source.replace(/^(\s*)appId\s*:\s*(['"]).*?\2\s*,?/mu, `$1appId: ${JSON.stringify(appId)},`),
      "utf-8",
    );
    return;
  }

  const exportDefaultObject = /(export\s+default\s+\{)(\r?\n)/u;
  if (exportDefaultObject.test(source)) {
    await writeFile(configPath, source.replace(exportDefaultObject, `$1$2${appIdLine}$2`), "utf-8");
    return;
  }

  const defineConfigObject =
    /(export\s+default\s+(?:defineTailorKitConfig|defineConfig)\(\s*\{)(\r?\n)/u;
  if (defineConfigObject.test(source)) {
    await writeFile(configPath, source.replace(defineConfigObject, `$1$2${appIdLine}$2`), "utf-8");
    return;
  }

  throw new Error(
    `Could not write appId to ${configPath}. Add appId: ${JSON.stringify(appId)} manually.`,
  );
};

const uploadAsset = async (
  asset: DeploymentAssetUpload | DeploymentLogoUpload,
  content: Buffer,
): Promise<void> => {
  if (!asset.uploadUrl) {
    return;
  }

  if (content.byteLength > maxDeploymentBytes) {
    throw new Error(`Deployment asset exceeds ${maxDeploymentBytes} bytes.`);
  }

  const headers = new Headers(asset.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/javascript");
  }

  const response = await fetch(asset.uploadUrl, {
    body: new Uint8Array(content),
    headers,
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(`Asset upload failed with ${response.status} ${response.statusText}.`);
  }
};

const resolveTsconfig = (root: string): string | undefined => {
  for (const filename of ["tsconfig.json", "jsconfig.json"]) {
    const filepath = path.join(root, filename);
    if (existsSync(filepath)) {
      return filepath;
    }
  }
};

const typecheckAppEntries = async (
  loaded: LoadedTailorKitConfig,
): Promise<TypecheckFailure | undefined> => {
  const baseTsconfig = resolveTsconfig(loaded.root);
  if (!baseTsconfig) {
    return;
  }
  const requireFromApp = createRequire(path.join(loaded.root, "package.json"));
  let compiler: string;
  try {
    compiler = path.join(
      path.dirname(requireFromApp.resolve("typescript/package.json")),
      "bin/tsc",
    );
  } catch {
    return;
  }
  const entryPath = path.resolve(loaded.root, loaded.config.client?.entry ?? "src/client.ts");
  // Check both application entry points with the project compiler options.
  const temporary = await mkdtemp(path.join(loaded.root, ".tailorkit-typecheck-"));
  try {
    const config = path.join(temporary, "tsconfig.json");
    await writeFile(
      config,
      JSON.stringify({
        extends: baseTsconfig,
        compilerOptions: { noEmit: true, incremental: false, composite: false },
        files: [
          entryPath,
          ...(loaded.config.server
            ? [path.resolve(loaded.root, loaded.config.server.entry ?? "src/server.ts")]
            : []),
        ],
        include: [],
      }),
    );
    await promisify(execFile)(
      process.execPath,
      [compiler, "--noEmit", "--project", config, "--pretty", "false"],
      { cwd: loaded.root, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    const failure = error as {
      code?: string | number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      command: `tsc --noEmit ${path.relative(loaded.root, entryPath)}`,
      exitCode: typeof failure.code === "number" ? failure.code : null,
      output:
        `${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim() || failure.message || String(error),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

// Keep the request/build lifecycle and its failure paths together.
// eslint-disable-next-line complexity
export const runDeploy = async (options: DeployOptions): Promise<DeployResult> => {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  let appId = loaded.config.appId;
  let createdApp = false;

  const auth = await runWhoami(options).catch((error: unknown) => {
    if (error instanceof NotLoggedInError && options.onLoginRequired) {
      return options.onLoginRequired();
    }
    throw error;
  });
  const storedAuth = await getDeployToken(auth.hostUrl);

  if (!storedAuth?.deployToken) {
    throw new Error(
      `Not logged in for ${auth.hostUrl}. Run tailorkit login after checking host in tailorkit.config.ts.`,
    );
  }

  const { buildApp, tailorkitUploadManifestSchema } = await import("@tailorkit/app/builder");
  const [buildResult, typecheckResult] = await Promise.allSettled([
    buildApp(options),
    typecheckAppEntries(loaded),
  ]);

  if (buildResult.status === "rejected") {
    throw buildResult.reason;
  }

  if (typecheckResult.status === "rejected") {
    throw typecheckResult.reason;
  }

  if (typecheckResult.value !== undefined) {
    const shouldContinue = await options.onTypecheckFailed?.(typecheckResult.value);
    if (!shouldContinue) {
      throw new Error("Deployment cancelled because type check failed.");
    }
  }

  const outDir = path.resolve(
    loaded.root,
    options.outDir ?? loaded.config.build?.outDir ?? ".tailorkit",
  );
  const manifest = await readUploadManifest(outDir, tailorkitUploadManifestSchema);
  const clientAssetPath = path.join(outDir, manifest.assets.client);
  const clientAsset = await readFile(clientAssetPath);
  const clientAssetGzip = await gzipAsync(clientAsset);
  const serverAsset = manifest.assets.server
    ? await readFile(path.join(outDir, manifest.assets.server))
    : undefined;
  const logoEntries = Object.entries(manifest.assets.logos ?? {}) as ["dark" | "light", string][];
  const logoAssets = await Promise.all(
    logoEntries.map(async ([variant, filename]) => {
      const content = await readFile(path.join(outDir, filename));
      const extension = path.extname(filename).slice(1);
      const contentType = logoContentTypeByExtension[extension];
      if (!contentType) {
        throw new Error(`Unsupported ${variant} logo format.`);
      }
      return { content, contentType, filename, variant };
    }),
  );
  if (clientAsset.byteLength > maxDeploymentBytes) {
    throw new Error(
      `Combined client assets are ${clientAsset.byteLength} bytes and cannot exceed ${maxDeploymentBytes} bytes.`,
    );
  }

  const client = createTailorKitClient({
    headers: { authorization: `Bearer ${storedAuth.deployToken}` },
    url: auth.hostUrl,
  });

  const createLinkedApp = async (reason: "missing" | "not-found"): Promise<string> => {
    const appName = await readAppName(loaded.root);
    const shouldCreateApp = await options.onMissingAppId?.({
      appName,
      configPath: loaded.filepath,
      hostUrl: auth.hostUrl,
      reason,
    });

    if (!shouldCreateApp) {
      throw new Error("Deployment cancelled.");
    }

    const app = unwrapRpcResult<AppCreateResult>(
      await client.apps.create({
        description: null,
        name: appName,
      }),
    );

    appId = app.id;
    createdApp = true;
    await writeAppIdToConfig(loaded.filepath, appId);
    return appId;
  };

  if (!appId) {
    appId = await createLinkedApp("missing");
  }

  const createDeployment = async (targetAppId: string): Promise<DeploymentCreateResult> =>
    unwrapRpcResult<DeploymentCreateResult>(
      await client.deployments.create({
        appId: targetAppId,
        assets: [
          {
            checksum: sha256Hex(clientAsset),
            contentLength: clientAsset.byteLength,
            contentType: "application/javascript" as const,
            encoding: "utf-8" as const,
            objectKey: "client.js" as const,
          },
        ],
        server: serverAsset
          ? {
              checksum: sha256Hex(serverAsset),
              contentLength: serverAsset.byteLength,
              contentType: "application/javascript" as const,
              encoding: "utf-8" as const,
              objectKey: "server.js" as const,
            }
          : undefined,
        logos:
          logoAssets.length > 0
            ? Object.fromEntries(
                logoAssets.map((asset) => [
                  asset.variant,
                  {
                    checksum: sha256Hex(asset.content),
                    contentLength: asset.content.byteLength,
                    contentType: asset.contentType,
                  },
                ]),
              )
            : undefined,
      }),
    );

  let created: DeploymentCreateResult;
  try {
    created = await createDeployment(appId);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }

    appId = await createLinkedApp("not-found");
    created = await createDeployment(appId);
  }

  if (created.assets.length !== 1 || !created.assets[0]) {
    throw new Error("Deployment did not return an upload URL for the client asset.");
  }
  if (serverAsset && !created.server) {
    throw new Error("Deployment did not return an upload URL for the server asset.");
  }
  await Promise.all([
    ...(serverAsset && created.server ? [uploadAsset(created.server, serverAsset)] : []),
    uploadAsset(created.assets[0], clientAsset),
    ...logoAssets.map((logo) => {
      const upload = created.logos?.[logo.variant];
      if (!upload) {
        throw new Error(`Deployment did not return an upload URL for the ${logo.variant} logo.`);
      }
      return uploadAsset(upload, logo.content);
    }),
  ]);

  const published = unwrapRpcResult<DeploymentPublishResult>(
    await client.deployments.publish({
      deploymentId: created.deployment.id,
      rollout: true,
    }),
  );

  const uploadedLogos = await Promise.all(
    logoAssets.map(async (asset) => {
      const compressed = await gzipAsync(asset.content);
      return {
        gzipSize: compressed.byteLength,
        path: asset.filename,
        size: asset.content.byteLength,
      };
    }),
  );

  const uploadedServer = [];
  if (serverAsset && manifest.assets.server) {
    const compressed = await gzipAsync(serverAsset);
    uploadedServer.push({
      gzipSize: compressed.byteLength,
      path: manifest.assets.server,
      size: serverAsset.byteLength,
    });
  }

  return {
    appId,
    createdApp,
    deploymentId: published.id,
    hostUrl: auth.hostUrl,
    status: published.status,
    uploadedFiles: [
      {
        gzipSize: clientAssetGzip.byteLength,
        path: manifest.assets.client,
        size: clientAsset.byteLength,
      },
      ...uploadedServer,
      ...uploadedLogos,
    ],
  };
};
