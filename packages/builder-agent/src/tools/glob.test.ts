import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { Experimental_SandboxSession as SandboxSession } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ZodType } from "zod";
import { globTool } from "./glob";

type Result = { paths: string[]; truncated: boolean; exitCode: number; stderr: string };
let root: string;

function write(path: string, content = "") {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

async function glob(pattern: string | string[], path = ".", abortSignal?: AbortSignal) {
  const run = vi.fn(async ({ command, workingDirectory }: Parameters<SandboxSession["run"]>[0]) => {
    const cwd =
      workingDirectory === "/workspace/app" || workingDirectory?.startsWith("/workspace/app/")
        ? join(root, relative("/workspace/app", workingDirectory))
        : workingDirectory;
    const child = spawnSync("bash", ["-c", command], {
      cwd,
      encoding: "utf8",
    });
    return { exitCode: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
  });
  const result = (globTool.outputSchema as ZodType<Result>).parse(
    await globTool.execute!(
      { pattern, path },
      {
        toolCallId: "test-glob",
        messages: [],
        context: {},
        experimental_sandbox: { run } as unknown as SandboxSession,
        abortSignal,
      },
    ),
  );
  expect(run).toHaveBeenCalledOnce();
  return { result, run };
}

describe("glob tool", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "builder-glob-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns structured relative paths and distinguishes root and recursive patterns", async () => {
    write("app.ts");
    write("nested/app.ts");
    write("nested/.hidden.ts");
    mkdirSync(join(root, ".git"));
    write(".gitignore", "node_modules/\n.git/\ndist/\n.next/\n");
    for (const dir of ["node_modules", ".git", "dist", ".next"]) write(dir + "/app.ts");
    const direct = await glob("*.ts");
    expect(direct.run.mock.calls[0]?.[0].workingDirectory).toBe("/workspace/app");
    expect(direct.result).toEqual({ paths: ["app.ts"], truncated: false, exitCode: 0, stderr: "" });
    const recursive = await glob("**/*.ts");
    expect(recursive.result.paths).toEqual(["app.ts", "nested/.hidden.ts", "nested/app.ts"]);
  });

  it("supports multiple includes, exclusions, and later overrides while including hidden files", async () => {
    expect((globTool.inputSchema as ZodType).safeParse({ pattern: [] }).success).toBe(false);
    for (const path of [
      ".hidden.ts",
      "app.ts",
      "app.tsx",
      "app.spec.ts",
      "nested/app.spec.ts",
      "nested/view.tsx",
    ]) {
      write(path);
    }
    const filtered = await glob(["**/*.ts", "**/*.tsx", "!**/*.spec.ts"]);
    expect(filtered.result.paths).toEqual([".hidden.ts", "app.ts", "app.tsx", "nested/view.tsx"]);
    const overridden = await glob(["**/*.ts", "!**/*.spec.ts", "**/*.spec.ts"]);
    expect(overridden.result.paths).toEqual([
      ".hidden.ts",
      "app.spec.ts",
      "app.ts",
      "nested/app.spec.ts",
    ]);
  });

  it("uses native glob precedence over ignore rules in a single command", async () => {
    mkdirSync(join(root, ".git"));
    write(".gitignore", "ignored.ts\nignored/\n");
    write("ignored.ts");
    write("ignored/app.ts");
    write("node_modules/app.ts");
    write("src/app.ts");
    const { result } = await glob("**/*.ts");
    expect(result.paths).toEqual(["ignored.ts", "node_modules/app.ts", "src/app.ts"]);
  });

  it("preserves unusual paths relative to the search directory and forwards cancellation", async () => {
    write("src/a'b\n.txt");
    const abortSignal = new AbortController().signal;
    const { result, run } = await glob("**/*.txt", "src", abortSignal);
    expect(result.paths).toEqual(["a'b\n.txt"]);
    expect(run.mock.calls[0]?.[0].workingDirectory).toBe("/workspace/app/src");
    expect(run.mock.calls[0]?.[0].abortSignal).toBe(abortSignal);
  });

  it("searches relative and absolute directories with the same results", async () => {
    write("src/new.txt");
    const local = await glob("*.txt", "./src");
    const absolute = await glob("*.txt", join(root, "src"));
    expect(local.result.paths).toEqual(["new.txt"]);
    expect(absolute.result).toEqual(local.result);
    expect(local.run.mock.calls[0]?.[0].workingDirectory).toBe("/workspace/app/src");
    expect(absolute.run.mock.calls[0]?.[0].workingDirectory).toBe(join(root, "src"));
  });

  it("marks truncation only when more than 200 files match", async () => {
    for (let index = 0; index < 200; index++) write(String(index).padStart(3, "0") + ".txt");
    const exact = await glob("*.txt");
    expect(exact.result.paths).toHaveLength(200);
    expect(exact.result.truncated).toBe(false);
    write("extra.txt");
    const extra = await glob("*.txt");
    expect(extra.result.paths).toEqual(exact.result.paths);
    expect(extra.result.truncated).toBe(true);
  });

  it("returns an empty structured result when no files match", async () => {
    const { result } = await glob("*.ts");
    expect(result).toEqual({ paths: [], truncated: false, exitCode: 1, stderr: "" });
  });

  it("caps sandbox stdout at 201 NUL-delimited paths even when ripgrep gets SIGPIPE", async () => {
    for (let index = 0; index < 5000; index++) {
      write(String(index).padStart(5, "0") + "-" + "x".repeat(100) + ".txt");
    }
    const { result, run } = await glob("*.txt");
    const output = await run.mock.results[0]!.value;

    expect(output.stdout.split("\0").filter(Boolean)).toHaveLength(201);
    expect(result.paths).toHaveLength(200);
    expect(result.truncated).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("preserves ripgrep failures through the output cap", async () => {
    const { result } = await glob("[z-a]");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("error");
  });

  it("preserves search errors", async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 2, stdout: "", stderr: "Permission denied" });
    const result = await globTool.execute!(
      { pattern: "*.ts", path: "." },
      {
        toolCallId: "test-glob",
        messages: [],
        context: {},
        experimental_sandbox: { run } as unknown as SandboxSession,
      },
    );
    expect(result).toEqual({
      paths: [],
      truncated: false,
      exitCode: 2,
      stderr: "Permission denied",
    });
  });
});
