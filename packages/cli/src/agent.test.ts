import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  info: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  autocomplete: mocks.select,
  text: mocks.text,
  cancel: mocks.cancel,
  isCancel: (value: unknown) => typeof value === "symbol",
  log: { info: mocks.info },
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("@tailorkit/app/config/loader", () => ({ loadTailorKitConfig: mocks.load }));
vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth")>()),
  runWhoami: mocks.whoami,
  getDeployToken: mocks.token,
}));
vi.mock("@tailorkit/core/server", () => ({ createTailorKitClient: mocks.client }));
vi.mock("./agent-tui", () => ({ openAgentTui: mocks.tui }));
const { runAgentCommand } = await import("./agent");
const { NotLoggedInError } = await import("./auth");
const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
let root: string;
let configPath: string;
const baseUrl = "https://host.test/api/tailorkit";

beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(tmpdir(), "tailorkit-agent-"));
  configPath = path.join(root, "tailorkit.config.ts");
  vi.spyOn(process, "cwd").mockReturnValue(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "my-app" }));
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  mocks.load.mockRejectedValue(new Error("Config must not be loaded"));
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
  expect(mocks.load).not.toHaveBeenCalled();
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  for (const [object, key, descriptor] of [
    [process.stdin, "isTTY", stdinTty],
    [process.stdout, "isTTY", stdoutTty],
  ] as const) {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  }
});

describe("agent command", () => {
  it("opens an explicit app from an empty directory using normalized base URL credentials", async () => {
    await rm(path.join(root, "package.json"));
    await runAgentCommand({ baseUrl: `${baseUrl}///`, appId: "app-one" });
    expect(mocks.client).toHaveBeenCalledWith({
      url: baseUrl,
      headers: { authorization: "Bearer cli-token" },
    });
    expect(mocks.token).toHaveBeenCalledWith(baseUrl);
    expect(mocks.tui.mock.lastCall![0].appId).toBe("app-one");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.text).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });
  it("ignores an existing config when choosing an app", async () => {
    const source = 'export default { host: "https://other.test", appId: "other-app" };\n';
    await writeFile(configPath, source);
    mocks.select.mockResolvedValueOnce("selected-app");
    await runAgentCommand({ baseUrl });
    expect(mocks.tui.mock.lastCall![0].appId).toBe("selected-app");
    expect(await readFile(configPath, "utf-8")).toBe(source);
  });
  it("prompts for the base URL first with a localhost default even when a config exists", async () => {
    await writeFile(configPath, 'export default { host: "https://other.test" };\n');
    const defaultBaseUrl = "http://localhost:3000/api/tailorkit";
    mocks.text.mockImplementationOnce(async ({ initialValue }) => {
      expect(mocks.whoami).not.toHaveBeenCalled();
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.select).not.toHaveBeenCalled();
      return initialValue;
    });
    await runAgentCommand({});
    const prompt = mocks.text.mock.calls[0]![0];
    expect(prompt).toEqual({
      message: "TailorKit API base URL",
      initialValue: defaultBaseUrl,
      placeholder: defaultBaseUrl,
      validate: expect.any(Function),
    });
    for (const value of [undefined, "", "   ", "localhost:3000", "ftp://host.test"]) {
      expect(prompt.validate(value)).toBe("Enter an absolute http:// or https:// base URL.");
    }
    expect(prompt.validate(defaultBaseUrl)).toBeUndefined();
    expect(prompt.validate(baseUrl)).toBeUndefined();
    expect(mocks.whoami).toHaveBeenCalledWith({ host: defaultBaseUrl });
    expect(mocks.token).toHaveBeenCalledWith(defaultBaseUrl);
    expect(mocks.tui).toHaveBeenCalledWith(expect.objectContaining({ hostUrl: defaultBaseUrl }));
  });
  it("uses the edited prompt URL for login, credentials, and the agent", async () => {
    mocks.text.mockResolvedValueOnce(`  ${baseUrl}///  `);
    mocks.whoami.mockRejectedValueOnce(new NotLoggedInError(baseUrl));
    const login = vi.fn().mockResolvedValue({});
    await runAgentCommand({ appId: "app-one", onLoginRequired: login });
    expect(login).toHaveBeenCalledWith(baseUrl);
    expect(mocks.whoami).toHaveBeenCalledTimes(2);
    expect(mocks.whoami).toHaveBeenCalledWith({ host: baseUrl });
    expect(mocks.token).toHaveBeenCalledWith(baseUrl);
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({ url: baseUrl }));
    expect(mocks.tui).toHaveBeenCalledWith(expect.objectContaining({ hostUrl: baseUrl }));
  });
  it("cancels at the base URL prompt before authenticating", async () => {
    mocks.text.mockResolvedValueOnce(Symbol("cancel"));
    await runAgentCommand({});
    expect(mocks.cancel).toHaveBeenCalledWith("Agent cancelled.");
    expect(mocks.whoami).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.tui).not.toHaveBeenCalled();
  });
  it.each(["", "   ", "localhost:3000", "ftp://host.test"])(
    "rejects invalid base URL %s before authenticating",
    async (invalidBaseUrl) => {
      await expect(runAgentCommand({ baseUrl: invalidBaseUrl })).rejects.toThrow("base URL");
      expect(mocks.whoami).not.toHaveBeenCalled();
    },
  );
  it("lists every page, searches by name or ID, and opens the selected app", async () => {
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
    await runAgentCommand({ baseUrl });
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
  it("creates a named app when none exist without writing config", async () => {
    mocks.text.mockResolvedValueOnce("  New app  ");
    await runAgentCommand({ baseUrl });
    expect(mocks.text).toHaveBeenCalledWith(expect.objectContaining({ initialValue: "My app" }));
    const { validate } = mocks.text.mock.lastCall![0];
    expect(validate("  ")).toBe("Enter an app name.");
    expect(validate("New app")).toBeUndefined();
    expect(mocks.create).toHaveBeenCalledWith({ name: "New app", description: null });
    expect(await readdir(root)).toEqual(["package.json"]);
    expect(mocks.info).toHaveBeenCalledWith("App: new-app");
    expect(mocks.tui.mock.lastCall![0].appId).toBe("new-app");
  });
  it("offers creation even when existing apps are available", async () => {
    mocks.list.mockResolvedValueOnce({
      items: [{ id: "existing", publicId: "existing-public", name: "Existing app" }],
      pagination: { hasMore: false },
    });
    await runAgentCommand({ baseUrl });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.tui.mock.lastCall![0].appId).toBe("new-app");
  });
  it.each(["select", "text"] as const)(
    "cancels at the %s prompt without creating an app",
    async (prompt) => {
      mocks[prompt].mockResolvedValueOnce(Symbol("cancel"));
      await runAgentCommand({ baseUrl });
      expect(mocks.cancel).toHaveBeenCalledWith("Agent cancelled.");
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.tui).not.toHaveBeenCalled();
    },
  );
  it.each(["list", "create"] as const)(
    "stops on a %s API failure without opening the agent",
    async (endpoint) => {
      mocks[endpoint].mockRejectedValueOnce(new Error("Host unavailable"));
      await expect(runAgentCommand({ baseUrl })).rejects.toThrow("Host unavailable");
      expect(mocks.tui).not.toHaveBeenCalled();
    },
  );
  it("propagates renderer failure", async () => {
    mocks.tui.mockRejectedValueOnce(new Error("Renderer failed"));
    await expect(runAgentCommand({ baseUrl })).rejects.toThrow("Renderer failed");
  });
  it("starts login when necessary and verifies approval before opening the TUI", async () => {
    mocks.whoami.mockRejectedValueOnce(new NotLoggedInError("host"));
    const login = vi.fn().mockResolvedValue({});
    mocks.list.mockImplementationOnce(async () => {
      expect(login).toHaveBeenCalledOnce();
      expect(mocks.whoami).toHaveBeenCalledTimes(2);
      return { items: [], pagination: { hasMore: false } };
    });
    await runAgentCommand({ baseUrl, onLoginRequired: login });
    expect(login).toHaveBeenCalledWith(baseUrl);
    expect(mocks.whoami).toHaveBeenCalledTimes(2);
    expect(mocks.whoami).toHaveBeenCalledWith(expect.objectContaining({ host: baseUrl }));
    expect(mocks.tui).toHaveBeenCalledOnce();
  });
  it("does not open a session when authentication fails", async () => {
    mocks.whoami.mockRejectedValueOnce(new Error("Host unavailable"));
    await expect(runAgentCommand({ baseUrl })).rejects.toThrow("Host unavailable");
    expect(mocks.tui).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects non-interactive use before authenticating", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    await expect(runAgentCommand({ baseUrl })).rejects.toThrow("interactive terminal");
    expect(mocks.whoami).not.toHaveBeenCalled();
  });
});
