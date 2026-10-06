import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { appAgent } from "./agent";

const mocks = vi.hoisted(() => ({
  configure: vi.fn(),
  prepareSandbox: vi.fn(),
  renewSandbox: vi.fn(),
  deleteSandbox: vi.fn(),
  sleep: vi.fn(),
  stream: vi.fn(),
  writable: {},
}));
vi.mock("./sandbox", () => ({
  prepareSandbox: mocks.prepareSandbox,
  renewSandbox: mocks.renewSandbox,
  deleteSandbox: mocks.deleteSandbox,
}));
vi.mock("@ai-sdk/workflow", () => ({
  WorkflowAgent: class {
    constructor(options: unknown) {
      mocks.configure(options);
    }
    stream = mocks.stream;
  },
}));
vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "run-1" }),
  sleep: mocks.sleep,
  getWritable: () => mocks.writable,
}));

const input = {
  appId: "app-123",
  model: "test-model",
  messages: [{ role: "user" as const, content: "Build my app" }],
};
const sandboxName = "app-agent-run-1";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sleep.mockImplementation(() => new Promise(() => {}));
  mocks.stream.mockImplementation(({ messages }) => Promise.resolve({ messages }));
});

describe("app agent workflow", () => {
  it("names the Drive directly from appId and streams only the supplied messages", async () => {
    expect(await appAgent(input)).toEqual({ messages: input.messages });
    expect(mocks.prepareSandbox).toHaveBeenCalledWith("app-app-123", sandboxName);
    expect(mocks.stream.mock.lastCall?.[0]).toMatchObject({
      messages: input.messages,
      writable: mocks.writable,
      timeout: 30 * 60_000,
    });
    expect(Object.keys(mocks.configure.mock.lastCall?.[0].tools)).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "glob",
      "ls",
    ]);
    expect(mocks.configure.mock.lastCall?.[0].toolsContext.write).toEqual({ sandboxName });
    expect(mocks.deleteSandbox).toHaveBeenCalledWith(sandboxName);
    expect(mocks.renewSandbox).not.toHaveBeenCalled();
  });

  it("renews during a long model call and deletes only after that call settles", async () => {
    const agent = Promise.withResolvers<{ messages: typeof input.messages }>();
    const timer = Promise.withResolvers<void>();
    mocks.stream.mockReturnValue(agent.promise);
    mocks.sleep.mockReturnValueOnce(timer.promise);
    const run = appAgent(input);
    await vi.waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
    timer.resolve();
    await vi.waitFor(() => expect(mocks.renewSandbox).toHaveBeenCalledWith(sandboxName));
    expect(mocks.sleep).toHaveBeenCalledWith("5m");
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
    agent.resolve({ messages: input.messages });
    await run;
    expect(mocks.deleteSandbox).toHaveBeenCalledTimes(1);
  });

  it("finishes an in-flight renewal before deleting the completed agent's sandbox", async () => {
    const agent = Promise.withResolvers<{ messages: typeof input.messages }>();
    const renewal = Promise.withResolvers<void>();
    mocks.stream.mockReturnValue(agent.promise);
    mocks.sleep.mockResolvedValueOnce(undefined);
    mocks.renewSandbox.mockReturnValue(renewal.promise);
    const run = appAgent(input);
    await vi.waitFor(() => expect(mocks.renewSandbox).toHaveBeenCalled());
    agent.resolve({ messages: input.messages });
    await Promise.resolve();
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
    renewal.resolve();
    await run;
    expect(mocks.deleteSandbox).toHaveBeenCalledTimes(1);
  });

  it("aborts on lost renewal but waits for the agent to settle before cleanup", async () => {
    const agent = Promise.withResolvers<{ messages: typeof input.messages }>();
    mocks.stream.mockReturnValue(agent.promise);
    mocks.sleep.mockResolvedValueOnce(undefined);
    mocks.renewSandbox.mockRejectedValue(new Error("Sandbox expired"));
    const run = appAgent(input);
    // Attach the rejection handler before settling the deferred model promise.
    const rejected = expect(run).rejects.toThrow("Sandbox expired");
    await vi.waitFor(() => expect(mocks.stream.mock.lastCall?.[0].abortSignal.aborted).toBe(true));
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
    agent.resolve({ messages: input.messages });
    await rejected;
    expect(mocks.deleteSandbox).toHaveBeenCalledWith(sandboxName);
  });

  it("cleans up model failures and fails busy Drive requests before starting the model", async () => {
    mocks.stream.mockRejectedValueOnce(new Error("Model failed"));
    await expect(appAgent(input)).rejects.toThrow("Model failed");
    expect(mocks.deleteSandbox).toHaveBeenCalledWith(sandboxName);
    mocks.stream.mockClear();
    mocks.prepareSandbox.mockRejectedValue(new Error("App is already being edited"));
    await expect(appAgent(input)).rejects.toThrow("already being edited");
    expect(mocks.stream).not.toHaveBeenCalled();
    // Cleanup always targets this run's name, never another writer's name.
    expect(mocks.deleteSandbox).toHaveBeenLastCalledWith(sandboxName);
  });
});
