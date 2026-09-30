import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateKeyPair, exportJWK, decodeJwt } from "jose";
import { loadTailorKitConfig } from "@tailorkit/app/config/loader";
import { createStorageClient, functionReference } from "@tailorkit/app-storage";
import { issueStorageToken } from "@tailorkit/app-storage/auth";
import { schemaFingerprint, storageTool } from "@tailorkit/app-storage/tooling";
import {
  buildApp,
  generateStorageModel,
  inspectStorage,
  storagePaths,
  startStorageRuntime,
} from "@tailorkit/app/builder";

export interface StorageOptions {
  cwd?: string;
  configPath?: string;
  name?: string;
  installation?: string;
  keyFile?: string;
  url?: string;
  tokenFile?: string;
}
function childProcess(tool: "drizzle-kit", args: string[], cwd: string) {
  return spawn(process.execPath, ["--preserve-symlinks-main", storageTool(tool), ...args], {
    cwd,
    stdio: "inherit",
  });
}
export async function generateStorage(options: StorageOptions) {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  const { store, schemaFile, migrations } = await generateStorageModel(loaded);
  const child = childProcess(
    "drizzle-kit",
    [
      "generate",
      "--dialect=sqlite",
      `--schema=${schemaFile}`,
      `--out=${migrations}`,
      ...(options.name ? [`--name=${options.name}`] : []),
    ],
    loaded.root,
  );
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Drizzle migration generation failed (${code})`)),
    );
  });
  await writeFile(
    path.join(migrations, "tailorkit-schema.sha256"),
    `${schemaFingerprint(store)}\n`,
  );
  // Generate browser refs without requiring signing keys or a configured runtime to exist yet.
  const { writeReferences } = await import("@tailorkit/app-storage/tooling");
  const config = loaded.config.storage;
  if (!config) {
    throw new Error("Configure storage first");
  }
  await writeReferences(
    path.resolve(loaded.root, config.references),
    path.resolve(loaded.root, config.entry),
    store,
  );
}
/** Loopback-only development credentials. Never used by the production host or app builder. */
export async function initStorageDev(options: StorageOptions) {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  const config = loaded.config.storage;
  if (!config || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.issuer).hostname)) {
    throw new Error("storage init-dev requires a loopback development issuer");
  }
  const privateFile = path.join(storagePaths(loaded).directory, "dev-host-key.json");
  const publicFile = path.resolve(loaded.root, config.publicKeys);
  try {
    await readFile(privateFile);
    throw new Error("Development keys already exist; reuse them or remove the dev key explicitly");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  await mkdir(path.dirname(privateFile), { recursive: true });
  await mkdir(path.dirname(publicFile), { recursive: true });
  await writeFile(
    privateFile,
    JSON.stringify({ ...(await exportJWK(privateKey)), kid: "local-dev" }),
    { mode: 0o600 },
  );
  await writeFile(
    publicFile,
    JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid: "local-dev" }] }, null, 2),
  );
}
export async function runStorageDev(options: StorageOptions) {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  if (!loaded.config.storage) {
    throw new Error("Configure storage first");
  }
  const watcher = await buildApp({ ...options, watch: true });
  let runtime: Awaited<ReturnType<typeof startStorageRuntime>>;
  try {
    runtime = await startStorageRuntime(loaded);
  } catch (error) {
    if (watcher && typeof watcher === "object" && "close" in watcher) {
      await (watcher as { close(): Promise<void> }).close();
    }
    throw error;
  }
  const close = async () => {
    await runtime.close();
    if (watcher && typeof watcher === "object" && "close" in watcher) {
      await (watcher as { close(): Promise<void> }).close();
    }
  };
  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
}
export async function seedStorage(options: StorageOptions) {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  const config = loaded.config.storage;
  if (
    !config ||
    !loaded.config.appId ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.issuer).hostname)
  ) {
    throw new Error("storage seed is local-only; configure a loopback issuer and appId");
  }
  const appId = loaded.config.appId;
  const store = await inspectStorage(loaded);
  const privateKey = JSON.parse(
    await readFile(
      options.keyFile ?? path.join(storagePaths(loaded).directory, "dev-host-key.json"),
      "utf-8",
    ),
  ) as JsonWebKey & { kid: string };
  const client = createStorageClient({
    getSession: async () => ({
      ...(await issueStorageToken(
        { issuer: config.issuer, audience: config.audience, privateKey, keyId: privateKey.kid },
        {
          appId,
          installationId: options.installation ?? "demo",
          userId: "local-developer",
        },
      )),
      url: `http://localhost:${config.port}/rpc`,
    }),
  });
  await client.mutate(functionReference(options.name ?? "seed", "mutation", store.apiVersion), {});
}
export async function resetStorage(options: StorageOptions) {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  if (!loaded.config.storage) {
    throw new Error("Configure storage first");
  }
  // An explicit reset command deletes only this app's local DO state, never keys or migration history.
  await rm(storagePaths(loaded).state, { force: true, recursive: true });
}

/** Applies the already-generated migration history in the running installation facet. */
export async function migrateStorage(options: StorageOptions) {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  const config = loaded.config.storage;
  if (!config || !loaded.config.appId) {
    throw new Error("Configure storage and a stable appId first");
  }
  if (!options.installation) {
    throw new Error("Specify --installation; migrations never target a client-supplied store ID");
  }
  const base = options.url ?? `http://localhost:${config.port}`;
  const target = new URL("/_tailorkit/migrate", base);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (target.protocol !== "https:" && !(local && target.protocol === "http:")) {
    throw new Error("Use HTTPS for remote migrations");
  }
  const manifest = JSON.parse(
    await readFile(path.join(storagePaths(loaded).directory, "storage-manifest.json"), "utf-8"),
  ) as {
    codeHash: string;
    apiVersion: number;
    migrations: { id: string; hash: string }[];
  };
  let token: string;
  if (options.tokenFile) {
    const contents = await readFile(options.tokenFile, "utf-8");
    token = contents.trim();
  } else {
    if (!local || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.issuer).hostname)) {
      throw new Error(
        "Remote migrations require --token-file containing an operator-issued migration JWT",
      );
    }
    const privateKey = JSON.parse(
      await readFile(
        options.keyFile ?? path.join(storagePaths(loaded).directory, "dev-host-key.json"),
        "utf-8",
      ),
    ) as JsonWebKey & { kid: string };
    const { issueStorageMigrationToken } = await import("@tailorkit/app-storage/auth");
    const issued = await issueStorageMigrationToken(
      { issuer: config.issuer, audience: config.audience, privateKey, keyId: privateKey.kid },
      {
        appId: loaded.config.appId,
        installationId: options.installation,
        userId: "local-developer",
      },
    );
    token = issued.token;
  }
  const claims = decodeJwt(token);
  if (claims.installationId !== options.installation || claims.appId !== loaded.config.appId) {
    throw new Error("Migration token does not match the selected app and installation");
  }
  // The signed identity selects the installation. The body contains artifact compatibility metadata only.
  const response = await fetch(target, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      codeHash: manifest.codeHash,
      apiVersion: manifest.apiVersion,
      migrations: manifest.migrations,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(
      `Storage migration failed (${response.status}): ${failure?.message ?? "Runtime rejected the request"}`,
    );
  }
}
