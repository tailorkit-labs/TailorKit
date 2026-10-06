import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  whoami: vi.fn(),
  token: vi.fn(),
  client: vi.fn(),
  tui: vi.fn(),
}));
vi.mock("./auth", () => ({
  runWhoami: mocks.whoami,
  resolveHostUrl: async () => "https://host.test/api/tailorkit",
  getDeployToken: mocks.token,
  NotLoggedInError: class extends Error {},
}));
vi.mock("@tailorkit/core/server", () => ({ createTailorKitClient: mocks.client }));
vi.mock("./agent-tui", () => ({ openAgentTui: mocks.tui }));
const { runAgentCommand, supportsOpenTui } = await import("./agent");
const { NotLoggedInError } = await import("./auth");
const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const bunVersion = Object.getOwnPropertyDescriptor(process.versions, "bun");

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  Object.defineProperty(process.versions, "bun", { configurable: true, value: "1.4.2" });
  mocks.whoami.mockResolvedValue({});
  mocks.token.mockResolvedValue({ deployToken: "cli-token" });
  mocks.client.mockReturnValue({ agent: { chat: vi.fn() } });
  mocks.tui.mockResolvedValue(undefined);
});
afterEach(() => {
  for (const [object, key, descriptor] of [
    [process.stdin, "isTTY", stdinTty],
    [process.stdout, "isTTY", stdoutTty],
    [process.versions, "bun", bunVersion],
  ] as const) {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  }
});

describe("agent command", () => {
  it("uses host credentials and a fresh local session each launch", async () => {
    await runAgentCommand({ cwd: "." });
    await runAgentCommand({ cwd: "." });
    expect(mocks.client).toHaveBeenCalledWith({
      url: "https://host.test/api/tailorkit",
      headers: { authorization: "Bearer cli-token" },
    });
    const first = mocks.tui.mock.calls[0]![0].sessionId;
    const second = mocks.tui.mock.calls[1]![0].sessionId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/u);
    expect(second).not.toBe(first);
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
  it("detects OpenTUI supported runtimes", () => {
    expect(supportsOpenTui({ node: "24.21.0" })).toBe(false);
    expect(supportsOpenTui({ node: "26.3.0" })).toBe(false);
    expect(supportsOpenTui({ node: "26.4.0" })).toBe(true);
    expect(supportsOpenTui({ node: "27.0.0" })).toBe(true);
    expect(supportsOpenTui({ node: "24.21.0", bun: "1.4.2" })).toBe(true);
    expect(supportsOpenTui({ node: "24.21.0", bun: "1.2.0" })).toBe(false);
  });
});
