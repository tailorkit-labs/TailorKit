import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Experimental_SandboxSession as SandboxSession } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ZodType } from "zod";
import { grepTool } from "./grep";

type Input = {
  pattern: string;
  path: string;
  glob?: string | string[];
  ignoreCase: boolean;
  literal: boolean;
  context: number;
  limit: number;
};
type Line = { line: number; text: string };
type Result = {
  exitCode: number;
  stderr: string;
  truncated: boolean;
  matches: (Line & { path: string; context?: { before: Line[]; after: Line[] } })[];
};
const schema = grepTool.inputSchema as ZodType<Input>;
let root: string;

function write(file: string, content: string | Uint8Array) {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

async function search(input: { pattern: string } & Partial<Input>, abortSignal?: AbortSignal) {
  const run = vi.fn(async ({ command, workingDirectory }: Parameters<SandboxSession["run"]>[0]) => {
    expect(workingDirectory).toBe("/workspace/app");
    const child = spawnSync("bash", ["-c", command], { cwd: root, encoding: "utf8" });
    return { exitCode: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
  });
  const result = (grepTool.outputSchema as ZodType<Result>).parse(
    await grepTool.execute!(schema.parse(input), {
      toolCallId: "test-grep",
      messages: [],
      context: {},
      experimental_sandbox: { run } as unknown as SandboxSession,
      abortSignal,
    }),
  );
  expect(run).toHaveBeenCalledOnce();
  return { result, run };
}

describe("grep tool", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "builder-grep-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("defaults to regex search with 100 matching lines and no context", () => {
    expect(schema.parse({ pattern: "target" })).toEqual({
      pattern: "target",
      path: ".",
      ignoreCase: false,
      literal: false,
      context: 0,
      limit: 100,
    });
    expect(schema.safeParse({ pattern: "target", context: -1 }).success).toBe(false);
    expect(schema.safeParse({ pattern: "target", context: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ pattern: "target", limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ pattern: "target", glob: [] }).success).toBe(false);
  });

  it("supports regex, literal text, and case-insensitive searches in one file", async () => {
    write("app.txt", "console.log(value)\nconsoleXlog(value)\nCONSOLE.LOG(value)\n");
    const regex = await search({ pattern: "console.log", path: "app.txt" });
    expect(regex.result.matches).toEqual([
      { path: "app.txt", line: 1, text: "console.log(value)" },
      { path: "app.txt", line: 2, text: "consoleXlog(value)" },
    ]);
    const literal = await search({ pattern: "console.log", path: "app.txt", literal: true });
    expect(literal.result.matches).toEqual([
      { path: "app.txt", line: 1, text: "console.log(value)" },
    ]);
    const insensitive = await search({
      pattern: "console.log",
      path: "app.txt",
      literal: true,
      ignoreCase: true,
    });
    expect(insensitive.result.matches).toEqual([
      { path: "app.txt", line: 1, text: "console.log(value)" },
      { path: "app.txt", line: 3, text: "CONSOLE.LOG(value)" },
    ]);
    const insensitiveRegex = await search({ pattern: "^CONSOLE[.]LOG", ignoreCase: true });
    expect(insensitiveRegex.result.matches).toEqual(insensitive.result.matches);
  });

  it("searches paths relative to the app and accepts absolute paths outside it", async () => {
    write("src/new.txt", "target\n");
    const local = await search({ pattern: "target", path: "./src/new.txt" });
    const path = join(root, "src/new.txt");
    const absolute = await search({ pattern: "target", path });
    expect(local.result.matches).toEqual([{ path: "src/new.txt", line: 1, text: "target" }]);
    expect(absolute.result.matches).toEqual([{ path, line: 1, text: "target" }]);
    expect(absolute.result.exitCode).toBe(0);
  });

  it("filters filenames and nested paths using globs", async () => {
    write("root.spec.ts", "target\n");
    write("src/nested/app.spec.ts", "target\n");
    write("src/app.ts", "target\n");
    write("app.js", "target\n");
    const typescript = await search({ pattern: "target", glob: "*.ts" });
    expect(typescript.result.matches.map((match) => match.path)).toEqual([
      "root.spec.ts",
      "src/app.ts",
      "src/nested/app.spec.ts",
    ]);
    const specs = await search({ pattern: "target", glob: "**/*.spec.ts" });
    expect(specs.result.matches.map((match) => match.path)).toEqual([
      "root.spec.ts",
      "src/nested/app.spec.ts",
    ]);
    const nested = await search({ pattern: "target", path: "src", glob: "src/nested/*.spec.ts" });
    expect(nested.result.matches).toEqual([
      { path: "src/nested/app.spec.ts", line: 1, text: "target" },
    ]);
  });

  it("supports multiple includes, exclusions, and later overrides while including hidden files", async () => {
    for (const path of [
      ".hidden.ts",
      "app.ts",
      "app.tsx",
      "app.spec.ts",
      "nested/app.spec.ts",
      "nested/view.tsx",
    ]) {
      write(path, "target\n");
    }
    const filtered = await search({ pattern: "target", glob: ["*.ts", "*.tsx", "!**/*.spec.ts"] });
    expect(filtered.result.matches.map((match) => match.path)).toEqual([
      ".hidden.ts",
      "app.ts",
      "app.tsx",
      "nested/view.tsx",
    ]);
    const overridden = await search({
      pattern: "target",
      glob: ["*.ts", "!*.spec.ts", "*.spec.ts"],
    });
    expect(overridden.result.matches.map((match) => match.path)).toEqual([
      ".hidden.ts",
      "app.spec.ts",
      "app.ts",
      "nested/app.spec.ts",
    ]);
  });

  it("limits matching lines globally and accurately reports truncation", async () => {
    write("a.txt", "before\ntarget\nafter\ntarget\nend\n");
    write("b.txt", "target\n");
    const limited = await search({ pattern: "target", context: 1, limit: 1 });
    expect(limited.result.matches).toEqual([
      {
        path: "a.txt",
        line: 2,
        text: "target",
        context: { before: [{ line: 1, text: "before" }], after: [{ line: 3, text: "after" }] },
      },
    ]);
    expect(limited.result.truncated).toBe(true);
    const global = await search({ pattern: "target", limit: 2 });
    expect(global.result.matches.map((match) => [match.path, match.line])).toEqual([
      ["a.txt", 2],
      ["a.txt", 4],
    ]);
    expect(global.result.truncated).toBe(true);
    const exact = await search({ pattern: "target", path: "a.txt", limit: 2 });
    expect(exact.result.matches).toHaveLength(2);
    expect(exact.result.truncated).toBe(false);
  });

  it("attaches context to each match, including overlapping windows", async () => {
    write("app.txt", "before\ntarget\ntarget\nafter\ngap\ngap\ntarget\nend\n");
    const { result } = await search({ pattern: "target", context: 1 });
    expect(result.matches).toEqual([
      {
        path: "app.txt",
        line: 2,
        text: "target",
        context: { before: [{ line: 1, text: "before" }], after: [{ line: 3, text: "target" }] },
      },
      {
        path: "app.txt",
        line: 3,
        text: "target",
        context: { before: [{ line: 2, text: "target" }], after: [{ line: 4, text: "after" }] },
      },
      {
        path: "app.txt",
        line: 7,
        text: "target",
        context: { before: [{ line: 6, text: "gap" }], after: [{ line: 8, text: "end" }] },
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("retains trailing context when another match exceeds the limit", async () => {
    write("app.txt", "before\ntarget\ntarget\nafter\n");
    const { result } = await search({ pattern: "target", context: 1, limit: 1 });
    expect(result.matches).toEqual([
      {
        path: "app.txt",
        line: 2,
        text: "target",
        context: { before: [{ line: 1, text: "before" }], after: [{ line: 3, text: "target" }] },
      },
    ]);
    expect(result.truncated).toBe(true);
  });

  it("bounds context to available lines at the start and end of a file", async () => {
    write("app.txt", "target\n\ntarget\n");
    const { result } = await search({ pattern: "target", context: 1_000_000 });
    expect(result.matches).toEqual([
      {
        path: "app.txt",
        line: 1,
        text: "target",
        context: {
          before: [],
          after: [
            { line: 2, text: "" },
            { line: 3, text: "target" },
          ],
        },
      },
      {
        path: "app.txt",
        line: 3,
        text: "target",
        context: {
          before: [
            { line: 1, text: "target" },
            { line: 2, text: "" },
          ],
          after: [],
        },
      },
    ]);
  });

  it.each(["-", "./-", "-leading"])(
    "searches the file %s instead of stdin or options",
    async (path) => {
      write(path, "target\n");
      const { result } = await search({ pattern: "target", path });
      expect(result.exitCode).toBe(0);
      expect(result.matches).toEqual([
        { path: path.replace(/^\.\//u, ""), line: 1, text: "target" },
      ]);
    },
  );

  it("handles CRLF line endings when matching line anchors", async () => {
    write("app.txt", "before\r\ntarget\r\nafter\r\n");
    const { result } = await search({ pattern: "^target$", context: 1 });
    expect(result.matches).toEqual([
      {
        path: "app.txt",
        line: 2,
        text: "target",
        context: { before: [{ line: 1, text: "before" }], after: [{ line: 3, text: "after" }] },
      },
    ]);
  });

  it("skips binary files and gitignored directories while searching hidden files", async () => {
    write("app.txt", "target\n");
    write(".hidden", "target\n");
    write("binary", Buffer.from("target\0"));
    mkdirSync(join(root, ".git"));
    write(".gitignore", "node_modules/\n.git/\ndist/\n.next/\n");
    for (const directory of ["node_modules", ".git", "dist", ".next"])
      write(directory + "/app.txt", "target\n");
    const { result } = await search({ pattern: "target" });
    expect(result.matches.map((match) => match.path)).toEqual([".hidden", "app.txt"]);
    const filtered = await search({ pattern: "target", glob: "**/*.txt" });
    expect(filtered.result.matches.map((match) => match.path)).toEqual(["app.txt"]);
  });

  it("uses native glob precedence over ignore rules without fixed directory exclusions", async () => {
    mkdirSync(join(root, ".git"));
    write(".gitignore", "ignored.ts\nignored/\n");
    write("ignored.ts", "target\n");
    write("ignored/app.ts", "target\n");
    write("node_modules/app.ts", "target\n");
    write("src/app.ts", "target\n");
    const normal = await search({ pattern: "target" });
    expect(normal.result.matches.map((match) => match.path)).toEqual([
      "node_modules/app.ts",
      "src/app.ts",
    ]);
    const filtered = await search({ pattern: "target", glob: "*.ts" });
    expect(filtered.result.matches.map((match) => match.path)).toEqual([
      "ignored.ts",
      "node_modules/app.ts",
      "src/app.ts",
    ]);
  });

  it("uses native .gitignore and .ignore rules during ordinary searches", async () => {
    mkdirSync(join(root, ".git"));
    write(".gitignore", "gitignored.txt\n");
    write(".ignore", "private.txt\n");
    write("gitignored.txt", "target\n");
    write("private.txt", "target\n");
    write("public.txt", "target\n");
    const { result } = await search({ pattern: "target" });
    expect(result.matches.map((match) => match.path)).toEqual(["public.txt"]);
  });

  it("returns structured empty results and preserves pattern and path errors", async () => {
    write("app.txt", "hello\n");
    const absent = await search({ pattern: "missing" });
    expect(absent.result).toEqual({ exitCode: 1, matches: [], truncated: false, stderr: "" });
    const invalid = await search({ pattern: "[" });
    expect(invalid.result.exitCode).toBe(2);
    expect(invalid.result.matches).toEqual([]);
    expect(invalid.result.stderr).toContain("regex parse error");
    const missing = await search({ pattern: "target", path: "missing" });
    expect(missing.result.exitCode).toBe(2);
    expect(missing.result.stderr).toContain("missing");
  });

  it("preserves unusual filenames and quotes inputs while forwarding cancellation", async () => {
    const path = "a'b:\n.txt";
    write(path, "it's $(a command)\n");
    const abortSignal = new AbortController().signal;
    const { result, run } = await search(
      { pattern: "it's $(a command)", path, literal: true },
      abortSignal,
    );
    expect(result.matches).toEqual([{ path, line: 1, text: "it's $(a command)" }]);
    expect(run.mock.calls[0]?.[0].abortSignal).toBe(abortSignal);
  });
});
