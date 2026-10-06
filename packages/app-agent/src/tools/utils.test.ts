import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { toolNativeSandbox, toolSandbox } from "./utils";

const mocks = vi.hoisted(() => ({
  getSandbox: vi.fn(),
  runCommand: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../sandbox", () => ({
  getSandbox: mocks.getSandbox,
  sandboxIdleTimeoutMs: 15 * 60_000,
}));
vi.mock("workflow", () => ({ FatalError: class extends Error {} }));

const session = {
  runCommand: mocks.runCommand,
  readFileToBuffer: mocks.read,
  writeFiles: mocks.write,
};
const options = { toolCallId: "call-1", messages: [], context: { sandboxName: "app-agent-run-1" } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSandbox.mockResolvedValue({ currentSession: () => session });
  mocks.runCommand.mockResolvedValue({
    exitCode: 0,
    stdout: () => Promise.resolve("ok"),
    stderr: () => Promise.resolve(""),
  });
});

describe("pinned tool session", () => {
  it("retrieves/renews the sandbox but returns the existing VM for tool operations", async () => {
    expect(await toolNativeSandbox(options)).toBe(session);
    expect(mocks.getSandbox).toHaveBeenCalledWith(options.context.sandboxName);
  });

  it("runs commands on the pinned VM with a process timeout", async () => {
    const sandbox = await toolSandbox(options);
    expect(await sandbox.run({ command: "pwd", workingDirectory: "/workspace/app" })).toEqual({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
    expect(mocks.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: "bash",
        args: ["-c", "pwd"],
        cwd: "/workspace/app",
        timeoutMs: 15 * 60_000,
      }),
    );
  });

  it("preserves full text, supports inclusive line ranges and returns null for missing files", async () => {
    const sandbox = await toolSandbox(options);
    mocks.read.mockResolvedValue(Buffer.from("one\ntwo\nthree\n"));
    expect(await sandbox.readTextFile({ path: "/workspace/app/test.txt" })).toBe(
      "one\ntwo\nthree\n",
    );
    expect(
      await sandbox.readTextFile({ path: "/workspace/app/test.txt", startLine: 2, endLine: 3 }),
    ).toBe("two\nthree");
    mocks.read.mockResolvedValue(null);
    expect(await sandbox.readTextFile({ path: "/missing" })).toBeNull();
  });

  it("creates parent directories and writes on the same pinned VM", async () => {
    const sandbox = await toolSandbox(options);
    await sandbox.writeTextFile({ path: "/workspace/app/src/test.ts", content: "hello" });
    expect(mocks.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: "mkdir",
        args: ["-p", "/workspace/app/src"],
      }),
    );
    expect(mocks.write).toHaveBeenCalledWith(
      [{ path: "/workspace/app/src/test.ts", content: Buffer.from("hello") }],
      expect.anything(),
    );
    expect(mocks.getSandbox).toHaveBeenCalledTimes(1);
  });
});
