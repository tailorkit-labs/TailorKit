import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Experimental_SandboxSession as SandboxSession, InferToolInput } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ZodType } from "zod";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { lsTool } from "./ls";
import { commandResultSchema } from "./utils";

const hasRipgrep = spawnSync("rg", ["--version"]).status === 0;
const options = (run: unknown, abortSignal?: AbortSignal) => ({
  toolCallId: "test-command",
  messages: [],
  context: {},
  experimental_sandbox: { run } as SandboxSession,
  abortSignal,
});
const input = <T>(schema: unknown, value: unknown) => (schema as ZodType<T>).parse(value);
const output = async (value: unknown) => commandResultSchema.parse(await value);

describe("command tools", () => {
  it.each([globTool, grepTool, lsTool])(
    "returns SDK output and forwards cancellation",
    async (tool) => {
      const result = { stdout: "plain output", stderr: "search error", exitCode: 2 };
      const run = vi.fn().mockResolvedValue(result);
      const abortSignal = new AbortController().signal;
      const value = input(tool.inputSchema, { pattern: "target", path: "." });
      expect(await tool.execute!(value as never, options(run, abortSignal))).toEqual(result);
      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.calls[0]?.[0].abortSignal).toBe(abortSignal);
      expect(run.mock.calls[0]?.[0].workingDirectory).toBe("/workspace/app");
    },
  );

  it("quotes glob patterns and resolves the search directory", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 1 });
    await globTool.execute!({ pattern: "a'$(touch injected)*", path: "src" }, options(run));
    expect(run).toHaveBeenCalledWith({
      command: "rg --no-config --files --hidden --glob 'a'\\''$(touch injected)*'",
      workingDirectory: "/workspace/app/src",
      abortSignal: undefined,
    });
  });

  it("quotes grep inputs and uses absolute paths for option-like filenames", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 1 });
    const value = input<InferToolInput<typeof grepTool>>(grepTool.inputSchema, {
      pattern: "a'$(touch injected)",
      path: "-",
      glob: "*.ts",
      ignoreCase: true,
      literal: true,
    });
    await grepTool.execute!(value, options(run));
    const command = run.mock.calls[0]?.[0].command;
    expect(command).toContain("'--ignore-case' '--fixed-strings' '--glob' '*.ts'");
    expect(command).toContain("'--' 'a'\\''$(touch injected)' '/workspace/app/-'");
  });

  describe("native commands", () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "builder-commands-"));
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "app.ts"), "console.log(value)\nconsoleXlog(value)\n");
      writeFileSync(join(root, "src", "view.tsx"), "CONSOLE.LOG(value)\n");
      writeFileSync(join(root, ".hidden.ts"), "target\n");
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const run = async ({ command, workingDirectory }: Parameters<SandboxSession["run"]>[0]) => {
      const result = spawnSync("/bin/bash", ["-c", command.replaceAll("/workspace/app", root)], {
        cwd: workingDirectory?.replaceAll("/workspace/app", root),
        encoding: "utf8",
      });
      if (result.error) throw result.error;
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
    };

    it.skipIf(!hasRipgrep)(
      "finds files using native glob semantics, including hidden files",
      async () => {
        const result = await output(
          globTool.execute!({ pattern: "*.ts", path: "." }, options(run)),
        );
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(result.stdout.trim().split("\n").sort()).toEqual([".hidden.ts", "app.ts"]);
        const nested = await output(
          globTool.execute!({ pattern: "*.tsx", path: "src" }, options(run)),
        );
        expect(nested.stdout.trim()).toBe("view.tsx");
        expect(
          (await output(globTool.execute!({ pattern: "*.missing", path: "." }, options(run))))
            .exitCode,
        ).toBe(1);
      },
    );

    it.skipIf(!hasRipgrep)(
      "searches regex and literal patterns and retains native errors",
      async () => {
        const search = (value: unknown) =>
          output(
            grepTool.execute!(
              input<InferToolInput<typeof grepTool>>(grepTool.inputSchema, value),
              options(run),
            ),
          );
        const regex = await search({ pattern: "console.log", path: "app.ts" });
        expect(regex.stdout).toBe(
          `${root}/app.ts:1:console.log(value)\n${root}/app.ts:2:consoleXlog(value)\n`,
        );
        const literal = await search({
          pattern: "console.log",
          literal: true,
          ignoreCase: true,
          glob: "*.tsx",
        });
        expect(literal.stdout).toBe(`${root}/src/view.tsx:1:CONSOLE.LOG(value)\n`);
        expect((await search({ pattern: "missing" })).exitCode).toBe(1);
        const invalid = await search({ pattern: "[" });
        expect(invalid.exitCode).toBe(2);
        expect(invalid.stderr).toContain("regex parse error");
      },
    );

    it("lists directory details and retains missing-path errors", async () => {
      const result = await output(lsTool.execute!({ path: "." }, options(run)));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(".hidden.ts");
      expect(result.stdout).toContain("src");
      const missing = await output(lsTool.execute!({ path: "missing" }, options(run)));
      expect(missing.exitCode).not.toBe(0);
      expect(missing.stderr).toContain("missing");
    });
  });
});
