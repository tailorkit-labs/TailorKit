import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { runDeploy } from "./deploy";

const mocks = vi.hoisted(() => ({
  actions: new Map<string, (options: Record<string, unknown>) => Promise<void>>(),
  login: vi.fn(),
  deploy: vi.fn(),
  open: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  outro: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("cac", () => ({
  cac: () => {
    const cli = {
      command: (name: string) => ({
        option: () => cli.command(name),
        action: (action: (options: Record<string, unknown>) => Promise<void>) => {
          mocks.actions.set(name, action);
          return cli;
        },
      }),
      option: vi.fn(),
      help: vi.fn(),
      version: vi.fn(),
      parse: vi.fn(),
    };
    return cli;
  },
}));
vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  intro: vi.fn(),
  isCancel: vi.fn(),
  log: { info: mocks.info, error: mocks.error },
  outro: mocks.outro,
  spinner: () => ({ start: mocks.start, stop: mocks.stop }),
}));
vi.mock("./auth", () => ({
  createCliAuthApprovalUrl: () => "https://host.example/cli-auth/approve?code=ABC-123",
  runLogin: mocks.login,
  runLogout: vi.fn(),
  runWhoami: vi.fn(),
}));
vi.mock("./deploy", () => ({ runDeploy: mocks.deploy }));
vi.mock("./generator/types", () => ({ generateTypes: vi.fn() }));
vi.mock("./init", () => ({ runInit: vi.fn() }));
vi.mock("./preview", () => ({ runPreview: vi.fn(), toPreviewOptions: vi.fn() }));
vi.mock("./utils/open-browser", () => ({ openUrlInBrowser: mocks.open }));

await import("./index");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.login.mockImplementation(async (_options, onUserCode) => {
    onUserCode({
      expiresAt: new Date("2030-01-01"),
      hostUrl: "https://host.example",
      userCode: "ABC-123",
    });
    return { hostUrl: "https://host.example" };
  });
});

it("opens login approval and resumes deploy with the selected config and working directory", async () => {
  mocks.deploy.mockImplementation(async (options: Parameters<typeof runDeploy>[0]) => {
    const auth = await options.onLoginRequired?.();
    expect(auth).toEqual({ hostUrl: "https://host.example" });
    expect(mocks.stop).toHaveBeenCalledWith("Approved.");
    return { hostUrl: auth?.hostUrl, appId: "app", deploymentId: "deployment", uploadedFiles: [] };
  });

  await mocks.actions.get("deploy")?.({ cwd: "/app", config: "custom.config.ts" });

  expect(mocks.login).toHaveBeenCalledWith(
    { cwd: "/app", configPath: "custom.config.ts" },
    expect.any(Function),
  );
  expect(mocks.open).toHaveBeenCalledWith("https://host.example/cli-auth/approve?code=ABC-123");
  expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("ABC-123"));
  expect(mocks.stop).toHaveBeenCalledWith("Authentication required.");
  expect(mocks.start).toHaveBeenLastCalledWith("Building and deploying app");
  expect(mocks.outro).toHaveBeenCalledWith("Deployment published.");
});

it("preserves standalone login timeout and --no-open behavior", async () => {
  await mocks.actions.get("login")?.({ cwd: "/app", open: false, timeout: 60 });

  expect(mocks.login).toHaveBeenCalledWith(
    { cwd: "/app", configPath: undefined, timeout: 60_000 },
    expect.any(Function),
  );
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.stop).toHaveBeenCalledWith("Approved.");
  expect(mocks.outro).toHaveBeenCalledWith("Authenticated successfully.");
});
