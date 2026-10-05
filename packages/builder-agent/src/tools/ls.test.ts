import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Experimental_SandboxSession as SandboxSession } from "ai";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ZodType } from "zod";
import { lsTool } from "./ls";

const schema = lsTool.inputSchema as ZodType<{ path: string; limit: number }>;

describe("ls tool", () => {
  it("defaults to the app directory and requires a positive integer limit", () => {
    expect(schema.parse({})).toEqual({ path: ".", limit: 500 });
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ limit: 501 }).success).toBe(true);
  });

  it("returns structured entries, accurate truncation, and errors", async () => {
    const root = mkdtempSync(join(tmpdir(), "builder-ls-"));
    const commands = mkdtempSync(join(tmpdir(), "builder-ls-commands-"));
    try {
      // Use the sandbox's GNU ls behavior on macOS too, with no Node on PATH.
      const nativeLs = execFileSync("which", [process.platform === "darwin" ? "gls" : "ls"], {
        encoding: "utf8",
      }).trim();
      symlinkSync(nativeLs, join(commands, "ls"));
      mkdirSync(join(root, "nested"));
      writeFileSync(join(root, ".hidden"), "");
      writeFileSync(join(root, "-leading"), "");
      writeFileSync(join(root, "a'b\\name\t.txt"), "");
      writeFileSync(join(root, "one.txt"), "");
      writeFileSync(join(root, "two.txt"), "");
      writeFileSync(join(root, "nested", "child.txt"), "");
      writeFileSync(join(root, "line\nbreak.txt"), "");
      symlinkSync("one.txt", join(root, "link"));
      symlinkSync("nested", join(root, "link-dir"));
      symlinkSync("missing", join(root, "missing-link"));
      expect(spawnSync("mkfifo", [join(root, "fifo")]).status).toBe(0);

      const run = vi.fn(
        async ({ command, workingDirectory }: Parameters<SandboxSession["run"]>[0]) => {
          expect(workingDirectory).toBeUndefined();
          // Map the sandbox's app directory to the local fixture without changing external paths.
          const child = spawnSync("/bin/bash", ["-c", command.replaceAll("/workspace/app", root)], {
            cwd: root,
            encoding: "utf8",
            env: { ...process.env, PATH: commands },
          });
          return {
            exitCode: child.status ?? 1,
            stdout: child.stdout ?? "",
            stderr: child.stderr ?? "",
          };
        },
      );
      const options = {
        toolCallId: "test-ls",
        messages: [],
        context: {},
        experimental_sandbox: { run } as unknown as SandboxSession,
      };
      const list = async (path: string, limit: number) =>
        (await lsTool.execute!({ path, limit }, options)) as {
          exitCode: number;
          stderr: string;
          entries: { name: string; type: string }[];
          truncated: boolean;
        };

      const limited = await list(".", 2);
      expect(limited.exitCode).toBe(0);
      expect(limited.entries).toHaveLength(2);
      expect(limited.truncated).toBe(true);

      const listing = await list(".", 500);
      expect(listing.entries).toEqual([
        { name: "-leading", type: "file" },
        { name: ".hidden", type: "file" },
        { name: "a'b\\name\t.txt", type: "file" },
        { name: "fifo", type: "other" },
        { name: "line\nbreak.txt", type: "file" },
        { name: "link", type: "symlink" },
        { name: "link-dir", type: "symlink" },
        { name: "missing-link", type: "symlink" },
        { name: "nested", type: "directory" },
        { name: "one.txt", type: "file" },
        { name: "two.txt", type: "file" },
      ]);
      expect(listing.truncated).toBe(false);
      expect(run.mock.calls[0]?.[0].command).toContain("cd -- '/workspace/app'");
      expect(limited.entries).toEqual(listing.entries.slice(0, 2));
      expect((lsTool.outputSchema as ZodType).parse(listing)).toEqual(listing);
      expect((await list(".", listing.entries.length)).truncated).toBe(false);
      const nested = await list("./nested", 500);
      expect(nested.entries).toEqual([{ name: "child.txt", type: "file" }]);
      expect(await list(join(root, "nested"), 500)).toEqual(nested);

      const unusualDirectory = "odd' path\n";
      mkdirSync(join(root, unusualDirectory));
      expect(await list(join(root, unusualDirectory), 2)).toEqual({
        entries: [],
        truncated: false,
        exitCode: 0,
        stderr: "",
      });
      mkdirSync(join(root, "-"));
      expect((await list("-", 2)).entries).toEqual([]);
      expect((await list("one.txt", 2)).exitCode).not.toBe(0);

      const missing = await list("missing", 2);
      expect(missing.exitCode).not.toBe(0);
      expect(missing.stderr).toContain("missing");
      expect(missing.entries).toEqual([]);
      expect(missing.truncated).toBe(false);

      // A failed ls must survive the pipeline and discard partial output.
      rmSync(join(commands, "ls"));
      writeFileSync(
        join(commands, "ls"),
        "#!/bin/bash\nprintf 'partial\\0'\nprintf 'listing failed' >&2\nexit 2\n",
        { mode: 0o755 },
      );
      expect(await list(".", 2)).toEqual({
        entries: [],
        truncated: false,
        exitCode: 2,
        stderr: "listing failed",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(commands, { recursive: true, force: true });
    }
  });
});
