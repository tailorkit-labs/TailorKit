import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  whoami: vi.fn(),
  token: vi.fn(),
  client: vi.fn(),
  tui: vi.fn(),
}));
vi.mock("@tailorkit/app/config/loader", () => ({ loadTailorKitConfig: mocks.load }));
vi.mock("./auth", () => ({
  runWhoami: mocks.whoami,
  resolveHostUrl: async () => "https://host.test/api/tailorkit",
  getDeployToken: mocks.token,
  NotLoggedInError: class extends Error {},
}));
vi.mock("@tailorkit/core/server", () => ({ createTailorKitClient: mocks.client }));
vi.mock("./agent-tui", () => ({ openAgentTui: mocks.tui }));
const { runAgentCommand } = await import("./agent");
const { NotLoggedInError } = await import("./auth");
const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  mocks.load.mockResolvedValue({ config: { appId: "app-one" } });
  mocks.whoami.mockResolvedValue({});
  mocks.token.mockResolvedValue({ deployToken: "cli-token" });
  mocks.client.mockReturnValue({ appAgent: { chat: vi.fn() } });
  mocks.tui.mockResolvedValue(undefined);
});
afterEach(() => {
  for (const [object, key, descriptor] of [
    [process.stdin, "isTTY", stdinTty],
    [process.stdout, "isTTY", stdoutTty],
  ] as const) {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  }
});

describe("agent command", () => {
  it("uses host credentials and the stable app ID across launches", async () => {
    await runAgentCommand({ cwd: "." });
    await runAgentCommand({ cwd: "." });
    expect(mocks.client).toHaveBeenCalledWith({
      url: "https://host.test/api/tailorkit",
      headers: { authorization: "Bearer cli-token" },
    });
    expect(mocks.tui.mock.calls.map(([options]) => options.appId)).toEqual(["app-one", "app-one"]);
  });
  it("allows an explicit app override", async () => {
    await runAgentCommand({ cwd: ".", appId: "app-two" });
    expect(mocks.tui.mock.lastCall![0].appId).toBe("app-two");
  });
  it("requires an app before authenticating or opening the terminal", async () => {
    mocks.load.mockResolvedValueOnce({ config: {} });
    await expect(runAgentCommand({ cwd: "." })).rejects.toThrow("Missing appId");
    expect(mocks.whoami).not.toHaveBeenCalled();
    expect(mocks.tui).not.toHaveBeenCalled();
  });
  it("propagates renderer failure", async () => {
    mocks.tui.mockRejectedValueOnce(new Error("Renderer failed"));
    await expect(runAgentCommand({ cwd: "." })).rejects.toThrow("Renderer failed");
  });
  it("starts login when necessary and verifies approval before opening the TUI", async () => {
    mocks.whoami.mockRejectedValueOnce(new NotLoggedInError("host"));
    const login = vi.fn().mockResolvedValue({});
    await runAgentCommand({ cwd: ".", onLoginRequired: login });
    expect(login).toHaveBeenCalledOnce();
    expect(mocks.whoami).toHaveBeenCalledTimes(2);
    expect(mocks.tui).toHaveBeenCalledOnce();
  });
  it("does not open a session when authentication fails", async () => {
    mocks.whoami.mockRejectedValueOnce(new Error("Host unavailable"));
    await expect(runAgentCommand({ cwd: "." })).rejects.toThrow("Host unavailable");
    expect(mocks.tui).not.toHaveBeenCalled();
  });
  it("rejects non-interactive use before authenticating", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    await expect(runAgentCommand({ cwd: "." })).rejects.toThrow("interactive terminal");
    expect(mocks.whoami).not.toHaveBeenCalled();
  });
});
