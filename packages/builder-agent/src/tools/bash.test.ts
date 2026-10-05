import type { Experimental_SandboxSession as SandboxSession } from "ai";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ZodType } from "zod";
import { bashTool } from "./bash";

const defaultInput: { command: string; cwd?: string; timeoutMs: number } = {
  command: "pwd",
  timeoutMs: 30_000,
};
const result = { exitCode: 0, stdout: "ok", stderr: "" };

function execute(run: unknown, input = defaultInput, abortSignal?: AbortSignal) {
  return bashTool.execute!(input, {
    toolCallId: "test-bash",
    messages: [],
    context: {},
    experimental_sandbox: { run } as SandboxSession,
    abortSignal,
  });
}

describe("bash tool", () => {
  it("defaults to /workspace/app with a 30-second timeout", async () => {
    expect((bashTool.inputSchema as ZodType).parse({ command: "pwd" })).toEqual(defaultInput);
    const run = vi.fn().mockResolvedValue(result);
    await execute(run);
    expect(run.mock.calls[0]?.[0].workingDirectory).toBe("/workspace/app");
  });

  it.each([
    ["./test", "/workspace/app/test"],
    ["src/../test", "/workspace/app/test"],
    ["/test", "/test"],
    ["/project/test", "/project/test"],
  ])("resolves cwd %s to %s", async (cwd, workingDirectory) => {
    const run = vi.fn().mockResolvedValue(result);

    await expect(execute(run, { ...defaultInput, cwd })).resolves.toEqual(result);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({
      command: "pwd",
      workingDirectory,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("rejects an already aborted call without starting a command", async () => {
    const run = vi.fn();
    const controller = new AbortController();
    const reason = new Error("Cancelled");
    controller.abort(reason);

    await expect(execute(run, defaultInput, controller.signal)).rejects.toBe(reason);
    expect(run).not.toHaveBeenCalled();
  });

  it("forwards cancellation to the running command", async () => {
    const run = vi.fn(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
        }),
    );
    const controller = new AbortController();
    const pending = execute(run, defaultInput, controller.signal);

    controller.abort("Cancelled");

    await expect(pending).rejects.toBe("Cancelled");
    expect(run.mock.calls[0]?.[0].abortSignal.aborted).toBe(true);
  });

  it("aborts a command after its timeout", async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(
        ({ abortSignal }: { abortSignal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
          }),
      );
      const pending = expect(execute(run, { ...defaultInput, timeoutMs: 50 })).rejects.toBe(
        "timeout: 50ms",
      );

      await vi.advanceTimersByTimeAsync(50);
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timer and cancellation listener when the command succeeds", async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn().mockResolvedValue(result);
      const controller = new AbortController();

      await expect(execute(run, defaultInput, controller.signal)).resolves.toEqual(result);
      expect(vi.getTimerCount()).toBe(0);

      const commandSignal = run.mock.calls[0]?.[0].abortSignal as AbortSignal;
      controller.abort();
      expect(commandSignal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timer and cancellation listener when the command fails", async () => {
    vi.useFakeTimers();
    try {
      const failure = new Error("Command failed");
      const run = vi.fn().mockRejectedValue(failure);
      const controller = new AbortController();

      await expect(execute(run, defaultInput, controller.signal)).rejects.toBe(failure);
      expect(vi.getTimerCount()).toBe(0);

      const commandSignal = run.mock.calls[0]?.[0].abortSignal as AbortSignal;
      controller.abort();
      expect(commandSignal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
