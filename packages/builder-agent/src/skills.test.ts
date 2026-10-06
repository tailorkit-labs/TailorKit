import { spawnSync } from "node:child_process";
import { globSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Experimental_SandboxSession as SandboxSession } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { formatSkills, getAvailableSkills as getCatalog } from "./skills";

const getAvailableSkills = async (...args: Parameters<typeof getCatalog>) =>
  (await getCatalog(...args)).skills;

let root: string;

function write(path: string, content: string) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function localSandbox(cwd = root, shell = "bash") {
  const run = vi.fn(({ command, workingDirectory }: Parameters<SandboxSession["run"]>[0]) => {
    expect(workingDirectory).toBeUndefined();
    // Map the sandbox app directory to the local repository fixture.
    const localCommand = command.replaceAll("/workspace/app", cwd);
    const child = spawnSync(shell, ["-c", localCommand], { cwd, encoding: "utf-8" });
    if (child.error) throw child.error;
    if (child.status === null)
      throw new Error(`Skill discovery process terminated: ${child.signal}`);
    return Promise.resolve({
      exitCode: child.status,
      stdout: (child.stdout ?? "").replaceAll(cwd, "/workspace/app"),
      stderr: child.stderr ?? "",
    });
  });
  return { sandbox: { run } as unknown as SandboxSession, run };
}

// The integration fixtures need the same shell and ripgrep flags as discovery.
// Missing local binaries should skip fixtures, not masquerade as an empty catalog.
const prerequisiteProbe = spawnSync(
  "bash",
  [
    "-c",
    "rg --no-config --multiline --json --only-matching --hidden --no-ignore --sort path --glob SKILL.md -- probe /dev/null",
  ],
  { encoding: "utf8" },
);
const hasDiscoveryPrerequisites = !prerequisiteProbe.error && prerequisiteProbe.status === 1;

describe("getAvailableSkills", () => {
  beforeEach(({ skip }) => {
    if (!hasDiscoveryPrerequisites) {
      skip();
      return;
    }
    root = mkdtempSync(join(tmpdir(), "builder-skills-"));
    mkdirSync(join(root, ".agents/skills"), { recursive: true });
  });
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("surfaces shell spawn failures instead of treating them as no matches", async () => {
    await expect(
      getCatalog(localSandbox(root, "builder-skills-nonexistent-shell").sandbox),
    ).rejects.toThrow("ENOENT");
  });

  it("returns only the opening frontmatter and keeps the path for each skill", async () => {
    write(
      ".agents/skills/quoted/SKILL.md",
      `---
name: quoted
description: 'Use ''quotes'' and colons: safely.'
license: MIT
compatibility: Requires Node.js
metadata:
  description: Nested metadata is ignored
---
name: body-name
description: Body text is ignored
\n---
name: example
description: Later frontmatter is ignored
---\n`,
    );
    write(
      ".agents/skills/folded/SKILL.md",
      "---\nname: folded\ndescription: >-\n  First line\n  second line\n---\n",
    );
    write(
      ".agents/skills/literal/SKILL.md",
      "---\nname: literal\ndescription: |\n  First line\n  second line\n---\n",
    );
    write(
      ".agents/skills/quoted/README.md",
      "---\nname: readme\ndescription: Wrong filename\n---\n",
    );

    const { sandbox, run } = localSandbox();
    const abortSignal = new AbortController().signal;
    await expect(getAvailableSkills(sandbox, abortSignal)).resolves.toEqual([
      {
        path: "/workspace/app/.agents/skills/folded/SKILL.md",
        name: "folded",
        description: "First line second line",
      },
      {
        path: "/workspace/app/.agents/skills/literal/SKILL.md",
        name: "literal",
        description: "First line\nsecond line\n",
      },
      {
        path: "/workspace/app/.agents/skills/quoted/SKILL.md",
        name: "quoted",
        description: "Use 'quotes' and colons: safely.",
        license: "MIT",
        compatibility: "Requires Node.js",
      },
    ]);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0].abortSignal).toBe(abortSignal);
  });

  it("handles CRLF, a BOM, closing delimiters at EOF, and unusual paths", async () => {
    const path = ".agents/skills/a'b\n/SKILL.md";
    write(path, '\uFEFF---\r\nname: unusual\r\ndescription: "A quoted: description"\r\n---');
    await expect(getAvailableSkills(localSandbox().sandbox)).resolves.toEqual([
      { path: `/workspace/app/${path}`, name: "unusual", description: "A quoted: description" },
    ]);
  });

  it("ignores body-only and unterminated frontmatter", async () => {
    write(
      ".agents/skills/body/SKILL.md",
      "# Instructions\n---\nname: body\ndescription: Example\n---\n",
    );
    write(".agents/skills/unfinished/SKILL.md", "---\nname: unfinished\ndescription: Example\n");
    await expect(getAvailableSkills(localSandbox().sandbox)).resolves.toEqual([]);
  });

  it.each([
    "name: broken\ndescription: [unterminated",
    "name: broken",
    "name: broken\ndescription: 42",
    "name: broken\nname: duplicate\ndescription: Duplicate key",
  ])("skips invalid frontmatter and reports its path: %s", async (frontmatter) => {
    write(".agents/skills/broken/SKILL.md", `---\n${frontmatter}\n---\n`);
    write(".agents/skills/valid/SKILL.md", "---\nname: valid\ndescription: Good metadata\n---\n");
    const catalog = await getCatalog(localSandbox().sandbox);
    expect(catalog.skills).toEqual([
      {
        path: "/workspace/app/.agents/skills/valid/SKILL.md",
        name: "valid",
        description: "Good metadata",
      },
    ]);
    expect(catalog.warnings).toEqual([
      expect.stringContaining(
        "Skipped invalid skill frontmatter: /workspace/app/.agents/skills/broken/SKILL.md",
      ),
    ]);
    expect(formatSkills(catalog)).toContain(JSON.stringify(catalog.warnings[0]));
  });

  it("returns an empty array when no skills match", async () => {
    await expect(getAvailableSkills(localSandbox().sandbox)).resolves.toEqual([]);
  });

  it("returns an empty array when the repo has no skills directory", async () => {
    rmSync(join(root, ".agents"), { recursive: true });
    await expect(getAvailableSkills(localSandbox().sandbox)).resolves.toEqual([]);
  });

  it("includes skills even when their directories are ignored", async () => {
    mkdirSync(join(root, ".git"));
    write(".gitignore", ".agents/skills/ignored/\n");
    write(
      ".agents/skills/ignored/SKILL.md",
      "---\nname: ignored\ndescription: Available locally\n---\n",
    );
    await expect(getAvailableSkills(localSandbox().sandbox)).resolves.toEqual([
      {
        path: "/workspace/app/.agents/skills/ignored/SKILL.md",
        name: "ignored",
        description: "Available locally",
      },
    ]);
  });

  it("preserves search failures instead of returning a partial catalog", async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 2, stdout: "", stderr: "Permission denied" });
    await expect(getAvailableSkills({ run } as unknown as SandboxSession)).rejects.toThrow(
      "Skill discovery failed: Permission denied",
    );
  });

  it("discovers the actual repo skills, including multiline descriptions", async () => {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const skills = await getAvailableSkills(localSandbox(repoRoot).sandbox);
    expect(skills).toContainEqual(
      expect.objectContaining({
        path: "/workspace/app/.agents/skills/ai-sdk/SKILL.md",
        name: "ai-sdk",
      }),
    );
    expect(skills).toContainEqual(
      expect.objectContaining({
        name: "turborepo",
        description: expect.stringContaining("Turborepo monorepo build system guidance"),
      }),
    );
    const paths = globSync(".agents/skills/**/SKILL.md", { cwd: repoRoot });
    expect(skills.map(({ path }) => path).toSorted()).toEqual(
      paths.map((path) => `/workspace/app/${path}`).toSorted(),
    );
  });
});

describe("formatSkills", () => {
  it("serializes multiline metadata and exact file paths as untrusted data", () => {
    const skills = [
      {
        name: "tailorkit-apps",
        description: "Build apps.\nRead the host contract first.",
        path: "/workspace/app/.agents/skills/tailorkit-apps/SKILL.md",
        compatibility: "Requires pnpm",
      },
    ];
    const prompt = formatSkills({ skills, warnings: [] });
    expect(JSON.parse(prompt)).toEqual({ type: "untrusted-skill-catalog", skills, warnings: [] });
  });

  it("represents an empty catalog without inventing instructions", () => {
    expect(JSON.parse(formatSkills({ skills: [], warnings: [] }))).toEqual({
      type: "untrusted-skill-catalog",
      skills: [],
      warnings: [],
    });
  });
});
