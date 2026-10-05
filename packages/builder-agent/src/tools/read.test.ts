import type { Experimental_SandboxSession as SandboxSession } from "ai";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ZodType } from "zod";
import { readTool } from "./read";

const filePath = "/project/app.txt";
const schema = readTool.inputSchema as ZodType<{
  path: string;
  startLine?: number;
  endLine?: number;
}>;

function options(sandbox?: SandboxSession, abortSignal?: AbortSignal) {
  return {
    toolCallId: "test-read",
    messages: [],
    context: {},
    experimental_sandbox: sandbox,
    abortSignal,
  };
}

describe("read tool", () => {
  it.each([
    { startLine: 0 },
    { startLine: -1 },
    { startLine: 1.5 },
    { endLine: 0 },
    { endLine: -1 },
    { endLine: 1.5 },
    { startLine: 3, endLine: 2 },
  ])("rejects invalid line range %j", (range) => {
    expect(schema.safeParse({ path: filePath, ...range }).success).toBe(false);
  });

  it("reports reversed ranges against endLine", () => {
    const result = schema.safeParse({ path: filePath, startLine: 3, endLine: 2 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["endLine"]);
    }
  });

  it("allows omitted bounds, single-line ranges, and bounds beyond EOF", () => {
    expect(schema.parse({ path: filePath })).toEqual({ path: filePath, startLine: 1 });
    for (const range of [
      { endLine: 1 },
      { startLine: 2 },
      { startLine: 2, endLine: 2 },
      { startLine: 2, endLine: 10_000 },
    ]) {
      expect(schema.safeParse({ path: filePath, ...range }).success).toBe(true);
    }
  });

  it.each(["app.txt", "./app.txt", "src/../app.txt"])(
    "resolves %s from /workspace/app",
    async (path) => {
      const readTextFile = vi.fn().mockResolvedValue("text");
      const sandbox = { readTextFile } as unknown as SandboxSession;

      await expect(readTool.execute!({ path }, options(sandbox))).resolves.toBe("text");
      expect(readTextFile).toHaveBeenCalledWith({
        path: "/workspace/app/app.txt",
        startLine: undefined,
        endLine: undefined,
        abortSignal: undefined,
      });
    },
  );

  it("returns text and forwards the line range and abort signal", async () => {
    const readTextFile = vi.fn().mockResolvedValue("second\nthird");
    const sandbox = { readTextFile } as unknown as SandboxSession;
    const abortSignal = new AbortController().signal;

    const result = await readTool.execute!(
      { path: filePath, startLine: 2, endLine: 3 },
      options(sandbox, abortSignal),
    );

    expect(result).toBe("second\nthird");
    expect(readTextFile).toHaveBeenCalledOnce();
    expect(readTextFile).toHaveBeenCalledWith({
      path: filePath,
      startLine: 2,
      endLine: 3,
      abortSignal,
    });
  });

  it("returns null when the file does not exist", async () => {
    const readTextFile = vi.fn().mockResolvedValue(null);
    const sandbox = { readTextFile } as unknown as SandboxSession;

    await expect(readTool.execute!({ path: filePath }, options(sandbox))).resolves.toBeNull();
    expect(readTextFile).toHaveBeenCalledWith({
      path: filePath,
      startLine: undefined,
      endLine: undefined,
      abortSignal: undefined,
    });
  });

  it("rejects when the sandbox is unavailable", async () => {
    await expect(readTool.execute!({ path: filePath }, options())).rejects.toThrow(
      "Sandbox not available",
    );
  });
});
