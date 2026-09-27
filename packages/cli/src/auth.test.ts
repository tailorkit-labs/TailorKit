import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type * as nodeOs from "node:os";
import path from "node:path";
import { loadTailorKitConfig } from "@tailorkit/app/config/loader";
import { createTailorKitClient } from "@tailorkit/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tailorkit/app/config/loader", () => ({
  loadTailorKitConfig: vi.fn(),
}));

vi.mock("@tailorkit/core/server", () => ({
  createTailorKitClient: vi.fn(),
}));

const temporaryDirectories: string[] = [];

const createTemporaryHome = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "tailorkit-auth-"));
  temporaryDirectories.push(directory);
  return directory;
};

const loadAuthModule = (homeDirectory: string) => {
  vi.resetModules();
  vi.doMock("node:os", async (importOriginal) => ({
    ...(await importOriginal<typeof nodeOs>()),
    homedir: () => homeDirectory,
  }));

  return import("./auth");
};

const authStorePath = (homeDirectory: string) =>
  path.join(homeDirectory, ".tailorkit", "auth.json");

const writeAuthStoreFixture = async (homeDirectory: string, value: unknown) => {
  const filePath = authStorePath(homeDirectory);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value));
  return filePath;
};

describe("auth store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.doUnmock("node:os");

    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it("stores and reads deploy tokens by host", async () => {
    const homeDirectory = await createTemporaryHome();
    const { getDeployToken, saveDeployToken } = await loadAuthModule(homeDirectory);

    await saveDeployToken("https://example.com", {
      deployToken: "deploy-token",
      scopeId: "scope-id",
    });

    await expect(getDeployToken("https://example.com")).resolves.toEqual({
      deployToken: "deploy-token",
      scopeId: "scope-id",
    });
  });

  it("validates auth.json before returning stored credentials", async () => {
    const homeDirectory = await createTemporaryHome();
    await writeAuthStoreFixture(homeDirectory, { hosts: { "https://example.com": {} } });
    const { getDeployToken } = await loadAuthModule(homeDirectory);

    await expect(getDeployToken("https://example.com")).rejects.toThrow();
  });

  it("preserves unknown top-level auth.json keys when saving a host token", async () => {
    const homeDirectory = await createTemporaryHome();
    const filePath = await writeAuthStoreFixture(homeDirectory, {
      futureKey: { value: true },
      hosts: {
        "https://existing.example.com": {
          deployToken: "existing-token",
        },
      },
    });
    const { saveDeployToken } = await loadAuthModule(homeDirectory);

    await saveDeployToken("https://new.example.com", {
      deployToken: "new-token",
      scopeId: "scope-id",
    });

    await expect(readFile(filePath, "utf-8").then(JSON.parse)).resolves.toEqual({
      futureKey: { value: true },
      hosts: {
        "https://existing.example.com": {
          deployToken: "existing-token",
        },
        "https://new.example.com": {
          deployToken: "new-token",
          scopeId: "scope-id",
        },
      },
    });
  });

  it("writes auth.json with user-only permissions", async () => {
    const homeDirectory = await createTemporaryHome();
    const { saveDeployToken } = await loadAuthModule(homeDirectory);

    await saveDeployToken("https://example.com", {
      deployToken: "deploy-token",
      scopeId: "scope-id",
    });

    const fileStat = await stat(authStorePath(homeDirectory));
    expect(fileStat.mode % 0o1000).toBe(0o600);
  });

  it("tightens permissions on an existing auth.json file", async () => {
    const homeDirectory = await createTemporaryHome();
    const filePath = await writeAuthStoreFixture(homeDirectory, { hosts: {} });
    await chmod(filePath, 0o644);
    const { saveDeployToken } = await loadAuthModule(homeDirectory);

    await saveDeployToken("https://example.com", {
      deployToken: "deploy-token",
      scopeId: "scope-id",
    });

    const fileStat = await stat(filePath);
    expect(fileStat.mode % 0o1000).toBe(0o600);
  });

  it("resolves the host URL from tailorkit.config.ts", async () => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com///" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    const { resolveHostUrl } = await loadAuthModule(homeDirectory);

    await expect(resolveHostUrl({ cwd: homeDirectory })).resolves.toBe("https://example.com");
    expect(loadTailorKitConfig).toHaveBeenCalledWith(undefined, homeDirectory);
  });

  it("creates a browser approval URL from the host API URL", async () => {
    const homeDirectory = await createTemporaryHome();
    const { createCliAuthApprovalUrl } = await loadAuthModule(homeDirectory);

    expect(createCliAuthApprovalUrl("https://example.com/api/tailorkit", "ABC-123-XYZ")).toBe(
      "https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ",
    );
  });

  it("treats failed token verification as not logged in", async () => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    vi.mocked(createTailorKitClient).mockReturnValue({
      cliAuth: {
        verifyToken: vi.fn().mockResolvedValue({
          data: undefined,
          error: new Error("token expired"),
        }),
      },
    } as unknown as ReturnType<typeof createTailorKitClient>);
    await writeAuthStoreFixture(homeDirectory, {
      hosts: {
        "https://example.com": {
          deployToken: "expired-token",
        },
      },
    });
    const { runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).rejects.toThrow(
      "Not logged in for https://example.com. Run tailorkit login after checking host in tailorkit.config.ts.",
    );
  });
});
