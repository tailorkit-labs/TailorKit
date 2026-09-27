import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { loadTailorKitConfig } from "@tailorkit/app/config/loader";
import { createTailorKitClient } from "@tailorkit/core/server";
import { z } from "zod";
import { normalizeHostUrl } from "./utils/url";

interface AuthOptions {
  configPath?: string;
  cwd: string;
}

interface LoginOptions extends AuthOptions {
  timeout?: number;
}

interface StoredHostAuth {
  deployToken: string;
  scope?: Record<string, string>;
}

interface AuthStore {
  hosts?: Record<string, StoredHostAuth>;
}

interface CliAuthStartResult {
  deviceCode: string;
  expiresAt: string | Date;
  userCode: string;
}

type CliAuthPollResult =
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | { deployToken: string; scope: Record<string, string>; status: "approved" };

interface CliAuthVerifyResult {
  scope: Record<string, string>;
}

const authStorePath = path.join(homedir(), ".tailorkit", "auth.json");
const defaultLoginTimeoutMs = 30 * 60 * 1000;
const pollIntervalMs = 2000;

const storedHostAuthSchema = z.object({
  deployToken: z.string().min(1),
  scope: z.record(z.string(), z.string()).optional(),
});

const authStoreSchema = z
  .object({
    hosts: z.record(z.string(), storedHostAuthSchema).optional(),
  })
  .passthrough();

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const throwRpcError = (result: unknown) => {
  if (result && typeof result === "object" && "error" in result && result.error !== undefined) {
    throw result.error;
  }
};

const readAuthStore = async (): Promise<AuthStore> => {
  try {
    return authStoreSchema.parse(JSON.parse(await readFile(authStorePath, "utf-8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
};

const writeAuthStore = async (store: AuthStore): Promise<void> => {
  await mkdir(path.dirname(authStorePath), { recursive: true });
  await writeFile(authStorePath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  await chmod(authStorePath, 0o600);
};

export const resolveHostUrl = async (options: AuthOptions): Promise<string> => {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  if (loaded.config.host) {
    return normalizeHostUrl(loaded.config.host);
  }

  throw new Error("Missing TailorKit host URL. Set host in tailorkit.config.ts.");
};

export const createCliAuthApprovalUrl = (hostUrl: string, userCode: string): string => {
  const url = new URL(hostUrl);
  const pathname = url.pathname.replace(/\/+$/u, "");

  url.pathname = `${pathname}/cli-auth/approve`;
  url.search = "";
  url.searchParams.set("code", userCode);
  url.hash = "";

  return url.toString();
};

const createNotLoggedInError = (hostUrl: string): Error =>
  new Error(
    `Not logged in for ${hostUrl}. Run tailorkit login after checking host in tailorkit.config.ts.`,
  );

export const saveDeployToken = async (
  hostUrl: string,
  auth: Required<StoredHostAuth>,
): Promise<void> => {
  const store = await readAuthStore();
  await writeAuthStore({
    ...store,
    hosts: {
      ...store.hosts,
      [hostUrl]: auth,
    },
  });
};

export const removeDeployToken = async (hostUrl: string): Promise<boolean> => {
  const store = await readAuthStore();
  if (!store.hosts?.[hostUrl]) {
    return false;
  }

  const { [hostUrl]: _removed, ...hosts } = store.hosts;
  const nextStore = { ...store, hosts };

  if (Object.keys(hosts).length === 0) {
    await rm(authStorePath, { force: true });
    return true;
  }

  await writeAuthStore(nextStore);
  return true;
};

export const getDeployToken = async (hostUrl: string): Promise<StoredHostAuth | undefined> => {
  const store = await readAuthStore();
  return store.hosts?.[hostUrl];
};

export const runLogin = async (
  options: LoginOptions,
  onUserCode: (details: { expiresAt: Date; hostUrl: string; userCode: string }) => void,
): Promise<{ hostUrl: string; scope: Record<string, string> }> => {
  const hostUrl = await resolveHostUrl(options);
  const client = createTailorKitClient({ url: hostUrl });
  const startResult = await client.cliAuth.start({});
  throwRpcError(startResult);

  const started = ("data" in startResult ? startResult.data : startResult) as CliAuthStartResult;
  const expiresAt = new Date(started.expiresAt);
  const timeoutAt = Date.now() + (options.timeout ?? defaultLoginTimeoutMs);

  onUserCode({ expiresAt, hostUrl, userCode: started.userCode });

  while (Date.now() < timeoutAt && Date.now() < expiresAt.getTime()) {
    await sleep(pollIntervalMs);
    const pollResult = await client.cliAuth.poll({ deviceCode: started.deviceCode });
    throwRpcError(pollResult);

    const result = ("data" in pollResult ? pollResult.data : pollResult) as CliAuthPollResult;

    switch (result.status) {
      case "pending": {
        continue;
      }
      case "denied": {
        throw new Error("CLI login was denied.");
      }
      case "expired": {
        throw new Error("CLI login expired.");
      }
      case "approved": {
        await saveDeployToken(hostUrl, {
          deployToken: result.deployToken,
          scope: result.scope,
        });

        return {
          hostUrl,
          scope: result.scope,
        };
      }
      default: {
        throw new Error("Unexpected CLI login status.");
      }
    }
  }

  throw new Error("Timed out waiting for CLI login approval.");
};

export const runWhoami = async (
  options: AuthOptions,
): Promise<{ hostUrl: string; scope: Record<string, string> }> => {
  const hostUrl = await resolveHostUrl(options);
  const auth = await getDeployToken(hostUrl);

  if (!auth?.deployToken) {
    throw createNotLoggedInError(hostUrl);
  }

  const client = createTailorKitClient({
    headers: { authorization: `Bearer ${auth.deployToken}` },
    url: hostUrl,
  });
  let result: CliAuthVerifyResult;
  try {
    const verifyResult = await client.cliAuth.verifyToken({});
    throwRpcError(verifyResult);

    result = ("data" in verifyResult ? verifyResult.data : verifyResult) as CliAuthVerifyResult;
  } catch {
    throw createNotLoggedInError(hostUrl);
  }

  await saveDeployToken(hostUrl, {
    deployToken: auth.deployToken,
    scope: result.scope,
  });

  return {
    hostUrl,
    scope: result.scope,
  };
};

export const runLogout = async (
  options: AuthOptions,
): Promise<{ hostUrl: string; removed: boolean }> => {
  const hostUrl = await resolveHostUrl(options);
  return {
    hostUrl,
    removed: await removeDeployToken(hostUrl),
  };
};
