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
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.doUnmock("node:os");

    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it("verifies the existing login directly with the platform when the host is offline", async () => {
    const home = await createTemporaryHome();
    const { runDeployWhoami } = await loadAuthModule(home);
    const host = "http://localhost:1/api/tailorkit";
    await writeAuthStoreFixture(home, { hosts: { [host]: { deployToken: "approved-token" } } });
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        projectId: "project-one",
        scope: { name: "user", value: { userId: "user-one" } },
      }),
    );
    await expect(runDeployWhoami({ host })).resolves.toMatchObject({ hostUrl: host });
    const request = fetch.mock.calls[0]![0] as Request;
    expect(request.url).toBe("https://tailorkit.dev/api/platform/cli/verify");
    expect(request.headers.get("authorization")).toBe("Bearer approved-token");
    expect(createTailorKitClient).not.toHaveBeenCalled();
  });

  it("uses a headless token without reading or writing the auth store", async () => {
    const home = await createTemporaryHome();
    const { runDeployWhoami } = await loadAuthModule(home);
    vi.stubEnv("TAILORKIT_DEPLOY_TOKEN", "headless-token");
    vi.stubEnv("TAILORKIT_PLATFORM_URL", "https://platform.test/api/platform");
    await writeAuthStoreFixture(home, "invalid store");
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        projectId: "project-one",
        scope: { name: "user", value: { userId: "user-one" } },
      }),
    );
    await runDeployWhoami({ host: "http://localhost:1/api/tailorkit" });
    const request = fetch.mock.calls[0]![0] as Request;
    expect(request.url).toBe("https://platform.test/api/platform/cli/verify");
    expect(request.headers.get("authorization")).toBe("Bearer headless-token");
    expect(await readFile(authStorePath(home), "utf-8")).toBe('"invalid store"');
  });

  it("reports expired platform credentials as requiring login", async () => {
    const { runDeployWhoami, NotLoggedInError } = await loadAuthModule(await createTemporaryHome());
    vi.stubEnv("TAILORKIT_DEPLOY_TOKEN", "expired-token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(
        {
          code: "UNAUTHORIZED",
          message: "Invalid CLI deploy token.",
        },
        { status: 401 },
      ),
    );
    await expect(
      runDeployWhoami({ host: "http://localhost:1/api/tailorkit" }),
    ).rejects.toBeInstanceOf(NotLoggedInError);
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

  it("resolves an explicit host without loading config", async () => {
    const homeDirectory = await createTemporaryHome();
    const { resolveHostUrl } = await loadAuthModule(homeDirectory);

    await expect(
      resolveHostUrl({
        cwd: homeDirectory,
        configPath: "missing.config.ts",
        host: "https://example.com/api/tailorkit///?unused=true#fragment",
      }),
    ).resolves.toBe("https://example.com/api/tailorkit");
    expect(loadTailorKitConfig).not.toHaveBeenCalled();
  });

  it.each(["", "localhost:3000", "ftp://example.com"])(
    "rejects invalid explicit host %s without falling back to config",
    async (host) => {
      const homeDirectory = await createTemporaryHome();
      const { resolveHostUrl } = await loadAuthModule(homeDirectory);

      await expect(resolveHostUrl({ cwd: homeDirectory, host })).rejects.toThrow("host URL");
      expect(loadTailorKitConfig).not.toHaveBeenCalled();
    },
  );

  it("logs in, verifies credentials, and logs out using an explicit host without config", async () => {
    vi.useFakeTimers();
    const homeDirectory = await createTemporaryHome();
    const hostUrl = "https://example.com/api/tailorkit";
    const scope = { name: "user", value: { userId: "user-1" } };
    const start = vi.fn().mockResolvedValue({
      deviceCode: "device-code",
      userCode: "ABC-123",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const poll = vi.fn().mockResolvedValue({
      status: "approved",
      deployToken: "deploy-token",
      scope,
    });
    const verifyToken = vi.fn().mockResolvedValue({ scope });
    vi.mocked(createTailorKitClient).mockReturnValue({
      cliAuth: { start, poll, verifyToken },
    } as unknown as ReturnType<typeof createTailorKitClient>);
    const { runLogin, runWhoami, runLogout, getDeployToken } = await loadAuthModule(homeDirectory);
    const onUserCode = vi.fn();
    const options = { cwd: homeDirectory, host: `${hostUrl}/` };
    const login = runLogin(options, onUserCode);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(login).resolves.toEqual({ hostUrl, scope });
    expect(onUserCode).toHaveBeenCalledWith(
      expect.objectContaining({ hostUrl, userCode: "ABC-123" }),
    );
    expect(poll).toHaveBeenCalledWith({ deviceCode: "device-code" });
    await expect(runWhoami(options)).resolves.toEqual({ hostUrl, scope });
    expect(createTailorKitClient).toHaveBeenLastCalledWith({
      url: hostUrl,
      headers: { authorization: "Bearer deploy-token" },
    });
    await expect(runLogout(options)).resolves.toEqual({ hostUrl, removed: true });
    await expect(getDeployToken(hostUrl)).resolves.toBeUndefined();
    expect(loadTailorKitConfig).not.toHaveBeenCalled();
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
      "Not logged in for https://example.com. Run tailorkit login --host https://example.com.",
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
