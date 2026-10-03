import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type * as nodeOs from "node:os";
import path from "node:path";
import { loadTailorKitConfig } from "@tailorkit/app/config/loader";
import { createTailorKitClient } from "@tailorkit/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

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
      scope: { name: "user", value: { userId: "user-1" } },
    });

    await expect(getDeployToken("https://example.com")).resolves.toEqual({
      deployToken: "deploy-token",
      scope: { name: "user", value: { userId: "user-1" } },
    });
  });

  it("validates auth.json before returning stored credentials", async () => {
    const homeDirectory = await createTemporaryHome();
    await writeAuthStoreFixture(homeDirectory, { hosts: { "https://example.com": {} } });
    const { getDeployToken } = await loadAuthModule(homeDirectory);

    await expect(getDeployToken("https://example.com")).rejects.toThrow();
  });

  it("keeps legacy tokens readable while discarding their unnamed scope", async () => {
    const homeDirectory = await createTemporaryHome();
    await writeAuthStoreFixture(homeDirectory, {
      hosts: {
        "https://example.com": {
          deployToken: "deploy-token",
          scope: { userId: "user-1" },
        },
      },
    });
    const { getDeployToken } = await loadAuthModule(homeDirectory);

    await expect(getDeployToken("https://example.com")).resolves.toEqual({
      deployToken: "deploy-token",
      scope: undefined,
    });
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
      scope: { name: "user", value: { userId: "user-1" } },
    });

    await expect(readFile(filePath, "utf-8").then(JSON.parse)).resolves.toEqual({
      futureKey: { value: true },
      hosts: {
        "https://existing.example.com": {
          deployToken: "existing-token",
        },
        "https://new.example.com": {
          deployToken: "new-token",
          scope: { name: "user", value: { userId: "user-1" } },
        },
      },
    });
  });

  it("writes auth.json with user-only permissions", async () => {
    const homeDirectory = await createTemporaryHome();
    const { saveDeployToken } = await loadAuthModule(homeDirectory);

    await saveDeployToken("https://example.com", {
      deployToken: "deploy-token",
      scope: { name: "user", value: { userId: "user-1" } },
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
      scope: { name: "user", value: { userId: "user-1" } },
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

  it("identifies missing host credentials as not logged in", async () => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    const { NotLoggedInError, runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).rejects.toBeInstanceOf(NotLoggedInError);
  });

  it("treats unauthorized token verification as not logged in", async () => {
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
          error: { code: "UNAUTHORIZED", message: "token expired" },
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
    const { NotLoggedInError, runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).rejects.toBeInstanceOf(NotLoggedInError);
    await expect(runWhoami({ cwd: homeDirectory })).rejects.toThrow(
      "Not logged in for https://example.com. Run tailorkit login after checking host in tailorkit.config.ts.",
    );
  });

  it.each([
    { label: "network rejection", error: new TypeError("fetch failed"), rejected: true },
    {
      label: "server RPC error",
      error: { code: "INTERNAL_SERVER_ERROR", message: "Service unavailable" },
      rejected: false,
    },
    { label: "forbidden rejection", error: { code: "FORBIDDEN" }, rejected: true },
    { label: "uncoded RPC error", error: new Error("Unexpected response"), rejected: false },
    { label: "string rejection", error: "Connection closed", rejected: true },
    { label: "null rejection", error: null, rejected: true },
  ])("preserves $label unchanged", async ({ error, rejected }) => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    const verifyToken = vi.fn();
    if (rejected) {
      verifyToken.mockRejectedValue(error);
    } else {
      verifyToken.mockResolvedValue({ error });
    }
    vi.mocked(createTailorKitClient).mockReturnValue({
      cliAuth: { verifyToken },
    } as unknown as ReturnType<typeof createTailorKitClient>);
    const fixture = { hosts: { "https://example.com": { deployToken: "deploy-token" } } };
    const filePath = await writeAuthStoreFixture(homeDirectory, fixture);
    const { runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).rejects.toBe(error);
    await expect(readFile(filePath, "utf-8").then(JSON.parse)).resolves.toEqual(fixture);
  });

  it("returns the verified named scope", async () => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    vi.mocked(createTailorKitClient).mockReturnValue({
      cliAuth: {
        verifyToken: vi.fn().mockResolvedValue({
          data: {
            scope: { name: "organization", value: { orgId: "org-1", userId: "user-1" } },
          },
        }),
      },
    } as unknown as ReturnType<typeof createTailorKitClient>);
    await writeAuthStoreFixture(homeDirectory, {
      hosts: { "https://example.com": { deployToken: "deploy-token" } },
    });
    const { runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).resolves.toEqual({
      hostUrl: "https://example.com",
      scope: { name: "organization", value: { orgId: "org-1", userId: "user-1" } },
    });
  });

  it("rejects a legacy verification response before changing stored auth", async () => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    vi.mocked(createTailorKitClient).mockReturnValue({
      cliAuth: {
        verifyToken: vi.fn().mockResolvedValue({ data: { scopeId: "legacy-scope" } }),
      },
    } as unknown as ReturnType<typeof createTailorKitClient>);
    const filePath = await writeAuthStoreFixture(homeDirectory, {
      hosts: { "https://example.com": { deployToken: "deploy-token" } },
    });
    const { runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).rejects.toBeInstanceOf(z.ZodError);
    await expect(readFile(filePath, "utf-8").then(JSON.parse)).resolves.toEqual({
      hosts: { "https://example.com": { deployToken: "deploy-token" } },
    });
  });
});
