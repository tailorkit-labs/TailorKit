import type { Experimental_SandboxSession as SandboxSession } from "ai";
import { describe, expect, it, vi } from "vite-plus/test";
import { editTool } from "./edit";

const filePath = "/workspace/app.txt";

function setup(initialContent: string | null, path = filePath) {
  let content = initialContent;
  const readTextFile = vi.fn(async () => content);
  const writeTextFile = vi.fn(async ({ content: next }: { content: string }) => {
    content = next;
  });
  const sandbox = { readTextFile, writeTextFile } as unknown as SandboxSession;

  const execute = (edits: { oldText: string; newText: string }[]) =>
    editTool.execute!(
      { path, edits },
      {
        toolCallId: "test-edit",
        messages: [],
        context: {},
        experimental_sandbox: sandbox,
      },
    );

  return { execute, readTextFile, writeTextFile, getContent: () => content };
}

describe("edit tool", () => {
  it.each(["src/app.txt", "./src/app.txt"])(
    "resolves %s for both reading and writing",
    async (path) => {
      const harness = setup("before", path);
      await expect(harness.execute([{ oldText: "before", newText: "after" }])).resolves.toEqual({
        success: true,
        path: "/workspace/app/src/app.txt",
      });
      expect(harness.readTextFile).toHaveBeenCalledWith({
        path: "/workspace/app/src/app.txt",
        abortSignal: undefined,
      });
      expect(harness.writeTextFile).toHaveBeenCalledWith({
        path: "/workspace/app/src/app.txt",
        content: "after",
        abortSignal: undefined,
      });
    },
  );

  it("applies edits in file order against the original content", async () => {
    const harness = setup("start\nmiddle\nend\n");

    const result = await harness.execute([
      { oldText: "end", newText: "done" },
      { oldText: "start", newText: "end" },
    ]);

    expect(result).toEqual({ success: true, path: filePath });

    expect(harness.getContent()).toBe("end\nmiddle\ndone\n");
    expect(harness.readTextFile).toHaveBeenCalledOnce();
    expect(harness.writeTextFile).toHaveBeenCalledOnce();
    expect(harness.writeTextFile).toHaveBeenCalledWith({
      path: filePath,
      content: "end\nmiddle\ndone\n",
      abortSignal: undefined,
    });
  });

  it("matches metacharacters literally and writes replacement text literally", async () => {
    const harness = setup("a.b\naxb\n");

    await harness.execute([{ oldText: "a.b", newText: "$&" }]);

    expect(harness.getContent()).toBe("$&\naxb\n");
  });

  it.each([
    ["missing text", "alpha\nbeta\n", [{ oldText: "gamma", newText: "x" }], /Text not found/],
    ["duplicate text", "alpha\nalpha\n", [{ oldText: "alpha", newText: "x" }], /more than once/],
    [
      "overlapping edits",
      "abcdef",
      [
        { oldText: "abc", newText: "x" },
        { oldText: "bcd", newText: "y" },
      ],
      /overlaps/,
    ],
  ])("rejects %s without changing the file", async (_name, initial, edits, message) => {
    const harness = setup(initial);

    await expect(harness.execute(edits)).rejects.toThrow(message);

    expect(harness.getContent()).toBe(initial);
    expect(harness.writeTextFile).not.toHaveBeenCalled();
  });

  it("rejects a missing file without writing", async () => {
    const harness = setup(null);

    await expect(harness.execute([{ oldText: "alpha", newText: "beta" }])).rejects.toThrow(
      "File not found",
    );
    expect(harness.writeTextFile).not.toHaveBeenCalled();
  });
});
