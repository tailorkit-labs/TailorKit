import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
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

const commandProbe = spawnSync(
  "bash",
  ["-c", "rg --no-config --json --hidden --sort path --crlf --context 0 --max-count 1 -- target -"],
  { input: "target\n", encoding: "utf8", timeout: 5_000 },
);
const nativeCommandsAvailable =
  !commandProbe.error &&
  commandProbe.status === 0 &&
  commandProbe.stdout.includes('"type":"match"');
const nativeSuiteName = nativeCommandsAvailable
  ? "native searches"
  : "native searches (skipped: compatible bash and ripgrep --json/--sort/--crlf required)";

function mockSearch(stdout: string, stderr = "", exitCode = 0) {
  const stream = (text: string) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
  const kill = vi.fn().mockResolvedValue(undefined);
  const run = vi.fn().mockResolvedValue({
    stdout: stream(stdout),
    stderr: stream(stderr),
    wait: async () => ({ exitCode }),
    kill,
  });
  const execute = async (input: { pattern: string } & Partial<Input>) =>
    (grepTool.outputSchema as ZodType<Result>).parse(
      await grepTool.execute!(schema.parse(input), {
        toolCallId: "test-grep",
        messages: [],
        context: {},
        experimental_sandbox: { spawn: run } as unknown as SandboxSession,
      }),
    );
  return { execute, run, kill };
}

function matchEvent(path: string, text = "target\n", line = 1) {
  return (
    JSON.stringify({
      type: "match",
      data: { path: { text: path }, lines: { text }, line_number: line },
    }) + "\n"
  );
}

function write(file: string, content: string | Uint8Array) {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

async function search(input: { pattern: string } & Partial<Input>, abortSignal?: AbortSignal) {
  const kill = vi.fn();
  const run = vi.fn(
    async ({ command, workingDirectory }: Parameters<SandboxSession["spawn"]>[0]) => {
      expect(workingDirectory).toBe("/workspace/app");
      const child = spawn("bash", ["-c", command], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const finished = new Promise<{ exitCode: number; error?: Error }>((resolve) => {
        child.once("error", (error) => resolve({ exitCode: 1, error }));
        child.once("close", (code) => resolve({ exitCode: code ?? 1 }));
      });
      kill.mockImplementation(async () => {
        child.kill();
      });
      return {
        stdout: Readable.toWeb(child.stdout),
        stderr: Readable.toWeb(child.stderr),
        wait: async () => {
          const result = await finished;
          if (result.error) throw result.error;
          return result;
        },
        kill,
      };
    },
  );
  const result = (grepTool.outputSchema as ZodType<Result>).parse(
    await grepTool.execute!(schema.parse(input), {
      toolCallId: "test-grep",
      messages: [],
      context: {},
      experimental_sandbox: { spawn: run } as unknown as SandboxSession,
      abortSignal,
    }),
  );
  expect(run).toHaveBeenCalledOnce();
  return { result, run, kill };
}

describe("grep tool", () => {
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
    expect(schema.safeParse({ pattern: "target", context: 21 }).success).toBe(false);
    expect(schema.safeParse({ pattern: "target", limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ pattern: "target", glob: [] }).success).toBe(false);
  });

  it("bounds output even when a matching line exceeds the byte budget", async () => {
    const { execute, kill } = mockSearch(
      matchEvent("app.txt") + matchEvent("app.txt", "target" + "x".repeat(2_097_152) + "\n", 2),
    );
    const result = await execute({ pattern: "target" });
    expect(result.matches).toEqual([{ path: "app.txt", line: 1, text: "target" }]);
    expect(result.truncated).toBe(true);
    expect(kill).toHaveBeenCalledOnce();
  });

  it.each([0, 1])(
    "stops parsing unrelated files after the sentinel with context %s",
    async (context) => {
      const { execute, kill } = mockSearch(
        matchEvent("a.txt") + matchEvent("b.txt") + "unparsed remainder",
      );
      const result = await execute({ pattern: "target", limit: 1, context });
      expect(result).toMatchObject({
        matches: [{ path: "a.txt", line: 1, text: "target" }],
        truncated: true,
        exitCode: 0,
      });
      expect(kill).toHaveBeenCalledOnce();
    },
  );

  it.each(["permission denied\n", "錯"])(
    "reports an error when stderr exceeds the output budget (%s)",
    async (diagnostic) => {
      const { execute, kill } = mockSearch("", diagnostic.repeat(100_000), 143);
      const result = await execute({ pattern: "target" });
      expect(result).toMatchObject({ exitCode: 2, truncated: true, matches: [] });
      expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(65_536);
      expect(kill).toHaveBeenCalledOnce();
    },
  );

  it("preserves search diagnostics when match-limit termination interrupts an error", async () => {
    const { execute } = mockSearch(
      matchEvent("a.txt") + matchEvent("b.txt"),
      "permission denied",
      143,
    );
    expect(await execute({ pattern: "target", limit: 1 })).toMatchObject({
      exitCode: 2,
      truncated: true,
    });
  });

  it.each([2, 127])("preserves command failure %s even after the match cap", async (exitCode) => {
    const { execute } = mockSearch(
      matchEvent("a.txt") + matchEvent("b.txt"),
      "search failed",
      exitCode,
    );
    expect(await execute({ pattern: "target", limit: 1 })).toMatchObject({
      exitCode,
      truncated: true,
    });
  });

  describe.skipIf(!nativeCommandsAvailable)(nativeSuiteName, () => {
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "builder-grep-"));
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
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
      const filtered = await search({
        pattern: "target",
        glob: ["*.ts", "*.tsx", "!**/*.spec.ts"],
      });
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

    it("stops ripgrep once a global extra match is found across files", async () => {
      for (let file = 0; file < 100; file++) {
        write(String(file).padStart(3, "0") + ".txt", "target\n");
      }
      const { result, kill } = await search({ pattern: "target", limit: 2 });
      expect(result.matches).toHaveLength(2);
      expect(result.truncated).toBe(true);
      expect(kill).toHaveBeenCalledOnce();
    });

    it("finishes trailing context when the extra match overlaps the final window", async () => {
      write("app.txt", "before\ntarget\ntarget\nafter\nend\n");
      const { result, kill } = await search({ pattern: "target", context: 2, limit: 1 });
      expect(result.matches[0]?.context?.after).toEqual([
        { line: 3, text: "target" },
        { line: 4, text: "after" },
      ]);
      expect(result.truncated).toBe(true);
      expect(kill).toHaveBeenCalledOnce();
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

    it("retains the full context window beyond the truncation sentinel", async () => {
      write("a.txt", "target\ntarget\ntarget\nafter\nignored\n");
      write("b.txt", "target\n");
      const { result } = await search({ pattern: "target", context: 3, limit: 1 });
      expect(result.matches).toEqual([
        {
          path: "a.txt",
          line: 1,
          text: "target",
          context: {
            before: [],
            after: [
              { line: 2, text: "target" },
              { line: 3, text: "target" },
              { line: 4, text: "after" },
            ],
          },
        },
      ]);
      expect(result.truncated).toBe(true);
    });

    it("bounds context to available lines at the start and end of a file", async () => {
      write("app.txt", "target\n\ntarget\n");
      const { result } = await search({ pattern: "target", context: 20 });
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
});
