import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  whoami: vi.fn(),
  token: vi.fn(),
  client: vi.fn(),
  tui: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  autocomplete: mocks.select,
  text: mocks.text,
  cancel: mocks.cancel,
  isCancel: (value: unknown) => typeof value === "symbol",
  log: { info: vi.fn() },
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
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
let root: string;
let configPath: string;

beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(tmpdir(), "tailorkit-agent-"));
  configPath = path.join(root, "tailorkit.config.ts");
  await writeFile(configPath, 'export default {\n  host: "https://host.test/api/tailorkit",\n};\n');
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "my-app" }));
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  mocks.load.mockResolvedValue({ root, filepath: configPath, config: { appId: "app-one" } });
  mocks.whoami.mockResolvedValue({});
  mocks.token.mockResolvedValue({ deployToken: "cli-token" });
  mocks.client.mockReturnValue({
    appAgent: { chat: vi.fn() },
    apps: { list: mocks.list, create: mocks.create },
  });
  mocks.list.mockResolvedValue({ items: [], pagination: { hasMore: false } });
  mocks.create.mockResolvedValue({ id: "new-app" });
  mocks.select.mockResolvedValue(null);
  mocks.text.mockResolvedValue("my-app");
  mocks.tui.mockResolvedValue(undefined);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
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
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("allows an explicit app override", async () => {
    await runAgentCommand({ cwd: ".", appId: "app-two" });
    expect(mocks.tui.mock.lastCall![0].appId).toBe("app-two");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(await readFile(configPath, "utf-8")).not.toContain("appId");
  });
  it("lists every page, searches by name or ID, and saves an existing app before opening it", async () => {
    mocks.load.mockResolvedValueOnce({ root, filepath: configPath, config: {} });
    mocks.list
      .mockResolvedValueOnce({
        items: [{ id: "app-one", publicId: "one", name: "First app" }],
        pagination: { hasMore: true },
      })
      .mockResolvedValueOnce({
        items: [{ id: "app-two", publicId: "two", name: "Second app" }],
        pagination: { hasMore: false },
      });
    mocks.select.mockResolvedValueOnce("app-two");
    mocks.tui.mockImplementationOnce(async () => {
      expect(await readFile(configPath, "utf-8")).toContain('appId: "app-two"');
    });
    await runAgentCommand({ cwd: root });
    expect(mocks.whoami).toHaveBeenCalledOnce();
    expect(mocks.list.mock.calls).toEqual([
      [{ page: 1, pageSize: 100 }],
      [{ page: 2, pageSize: 100 }],
    ]);
    const prompt = mocks.select.mock.lastCall![0];
    expect(prompt.options).toEqual([
      { value: "app-one", label: "First app", hint: "one" },
      { value: "app-two", label: "Second app", hint: "two" },
      { value: null, label: "Create a new app" },
    ]);
    expect(prompt.filter("SECOND", prompt.options[1])).toBe(true);
    expect(prompt.filter("two", prompt.options[1])).toBe(true);
    expect(prompt.filter("app-two", prompt.options[1])).toBe(true);
    expect(prompt.filter("missing", prompt.options[1])).toBe(false);
    expect(prompt.filter("missing", prompt.options[2])).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.tui.mock.lastCall![0].appId).toBe("app-two");
  });
  it("creates a named app when none exist and saves its ID", async () => {
    mocks.load.mockResolvedValueOnce({ root, filepath: configPath, config: {} });
    mocks.text.mockResolvedValueOnce("  New app  ");
    await runAgentCommand({ cwd: root });
    expect(mocks.text).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: "my-app" }));
    const { validate } = mocks.text.mock.lastCall![0];
    expect(validate("  ")).toBe("Enter an app name.");
    expect(validate("New app")).toBeUndefined();
    expect(mocks.create).toHaveBeenCalledWith({ name: "New app", description: null });
    expect(await readFile(configPath, "utf-8")).toContain('appId: "new-app"');
    expect(mocks.tui.mock.lastCall![0].appId).toBe("new-app");
  });
  it("offers creation even when existing apps are available", async () => {
    mocks.load.mockResolvedValueOnce({ root, filepath: configPath, config: {} });
    mocks.list.mockResolvedValueOnce({
      items: [{ id: "existing", publicId: "existing-public", name: "Existing app" }],
      pagination: { hasMore: false },
    });
    await runAgentCommand({ cwd: root });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.tui.mock.lastCall![0].appId).toBe("new-app");
  });
  it.each([
    {
      source: 'export default { host: "https://host.test", appId: undefined };\n',
      expected: 'export default { host: "https://host.test", appId: "chosen-app" };\n',
    },
    {
      source: 'export default defineConfig({ host: "https://host.test" });\n',
      expected:
        'export default defineConfig({ appId: "chosen-app", host: "https://host.test" });\n',
    },
    {
      source:
        'const other = {\n  appId: "unrelated",\n};\nconst config = {\n  host: "https://host.test",\n};\nexport default config;\n',
      expected:
        'const other = {\n  appId: "unrelated",\n};\nconst config = {\n  appId: "chosen-app",\n  host: "https://host.test",\n};\nexport default config;\n',
    },
  ])("updates only the exported config in $source", async ({ source, expected }) => {
    await writeFile(configPath, source);
    mocks.load.mockResolvedValueOnce({ root, filepath: configPath, config: {} });
    mocks.select.mockResolvedValueOnce("chosen-app");
    await runAgentCommand({ cwd: root });
    expect(await readFile(configPath, "utf-8")).toBe(expected);
    expect(mocks.tui.mock.lastCall![0].appId).toBe("chosen-app");
  });
  it.each(["select", "text"] as const)(
    "cancels at the %s prompt without creating or linking",
    async (prompt) => {
      mocks.load.mockResolvedValueOnce({ root, filepath: configPath, config: {} });
      mocks[prompt].mockResolvedValueOnce(Symbol("cancel"));
      await runAgentCommand({ cwd: root });
      expect(mocks.cancel).toHaveBeenCalledWith("Agent cancelled.");
      expect(mocks.create).not.toHaveBeenCalled();
      expect(await readFile(configPath, "utf-8")).not.toContain("appId");
      expect(mocks.tui).not.toHaveBeenCalled();
    },
  );
  it.each(["list", "create"] as const)(
    "stops on a %s API failure without linking or opening the agent",
    async (endpoint) => {
      mocks.load.mockResolvedValueOnce({ root, filepath: configPath, config: {} });
      mocks[endpoint].mockRejectedValueOnce(new Error("Host unavailable"));
      await expect(runAgentCommand({ cwd: root })).rejects.toThrow("Host unavailable");
      expect(await readFile(configPath, "utf-8")).not.toContain("appId");
      expect(mocks.tui).not.toHaveBeenCalled();
    },
  );
  it("reports the chosen ID if the config cannot be updated", async () => {
    await writeFile(configPath, "export default getConfig();\n");
    mocks.load.mockResolvedValueOnce({ root, filepath: configPath, config: {} });
    mocks.select.mockResolvedValueOnce("chosen-app");
    await expect(runAgentCommand({ cwd: root })).rejects.toThrow(
      'Add appId: "chosen-app" manually.',
    );
    expect(mocks.tui).not.toHaveBeenCalled();
  });
  it("propagates renderer failure", async () => {
    mocks.tui.mockRejectedValueOnce(new Error("Renderer failed"));
    await expect(runAgentCommand({ cwd: "." })).rejects.toThrow("Renderer failed");
  });
  it("starts login when necessary and verifies approval before opening the TUI", async () => {
    mocks.load.mockResolvedValueOnce({ root, filepath: configPath, config: {} });
    mocks.whoami.mockRejectedValueOnce(new NotLoggedInError("host"));
    const login = vi.fn().mockResolvedValue({});
    mocks.list.mockImplementationOnce(async () => {
      expect(login).toHaveBeenCalledOnce();
      expect(mocks.whoami).toHaveBeenCalledTimes(2);
      return { items: [], pagination: { hasMore: false } };
    });
    await runAgentCommand({ cwd: ".", onLoginRequired: login });
    expect(login).toHaveBeenCalledOnce();
    expect(mocks.whoami).toHaveBeenCalledTimes(2);
    expect(mocks.tui).toHaveBeenCalledOnce();
  });
  it("does not open a session when authentication fails", async () => {
    mocks.load.mockResolvedValueOnce({ root, filepath: configPath, config: {} });
    mocks.whoami.mockRejectedValueOnce(new Error("Host unavailable"));
    await expect(runAgentCommand({ cwd: "." })).rejects.toThrow("Host unavailable");
    expect(mocks.tui).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects non-interactive use before authenticating", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    await expect(runAgentCommand({ cwd: "." })).rejects.toThrow("interactive terminal");
    expect(mocks.whoami).not.toHaveBeenCalled();
  });
});
