import type { Experimental_SandboxSession as SandboxSession } from "ai";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ZodType } from "zod";
import { writeTool } from "./write";

const filePath = "/workspace/nested/app.txt";

function options(sandbox?: SandboxSession, abortSignal?: AbortSignal) {
  return {
    toolCallId: "test-write",
    messages: [],
    context: {},
    experimental_sandbox: sandbox,
    abortSignal,
  };
}

describe("write tool", () => {
  it("rejects an empty file path", () => {
    expect(
      (writeTool.inputSchema as ZodType).safeParse({ path: "", content: "text" }).success,
    ).toBe(false);
  });

  it.each(["src/new.txt", "./src/new.txt"])("resolves %s from /workspace/app", async (path) => {
    const writeTextFile = vi.fn().mockResolvedValue(undefined);
    const sandbox = { writeTextFile } as unknown as SandboxSession;

    await expect(writeTool.execute!({ path, content: "hello" }, options(sandbox))).resolves.toEqual(
      {
        success: true,
        path: "/workspace/app/src/new.txt",
      },
    );
    expect(writeTextFile).toHaveBeenCalledWith({
      path: "/workspace/app/src/new.txt",
      content: "hello",
      abortSignal: undefined,
    });
  });

  it("writes the supplied content and forwards the abort signal", async () => {
    const writeTextFile = vi.fn().mockResolvedValue(undefined);
    const sandbox = { writeTextFile } as unknown as SandboxSession;
    const abortSignal = new AbortController().signal;

    await expect(
      writeTool.execute!(
        { path: filePath, content: "hello\nworld\n" },
        options(sandbox, abortSignal),
      ),
    ).resolves.toEqual({ success: true, path: filePath });

    expect(writeTextFile).toHaveBeenCalledOnce();
    expect(writeTextFile).toHaveBeenCalledWith({
      path: filePath,
      content: "hello\nworld\n",
      abortSignal,
    });
  });

  it("allows empty content to replace a file", async () => {
    const writeTextFile = vi.fn().mockResolvedValue(undefined);
    const sandbox = { writeTextFile } as unknown as SandboxSession;

    await writeTool.execute!({ path: filePath, content: "" }, options(sandbox));

    expect(writeTextFile).toHaveBeenCalledWith({
      path: filePath,
      content: "",
      abortSignal: undefined,
    });
  });

  it("rejects when the sandbox is unavailable", async () => {
    await expect(
      writeTool.execute!({ path: filePath, content: "hello" }, options()),
    ).rejects.toThrow("Sandbox not available");
  });

  it("propagates a sandbox write failure", async () => {
    const failure = new Error("Permission denied");
    const writeTextFile = vi.fn().mockRejectedValue(failure);
    const sandbox = { writeTextFile } as unknown as SandboxSession;

    await expect(
      writeTool.execute!({ path: filePath, content: "hello" }, options(sandbox)),
    ).rejects.toBe(failure);
    expect(writeTextFile).toHaveBeenCalledOnce();
  });
});
