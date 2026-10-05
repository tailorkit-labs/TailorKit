import type { Experimental_SandboxSession as SandboxSession } from "ai";
import { FatalError } from "workflow";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { appDirectory, quote } from "./tools/utils";

const skillMetadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  license: z.string().optional(),
  compatibility: z.string().optional(),
});

export type AvailableSkill = z.infer<typeof skillMetadataSchema> & { path: string };

export type SkillCatalog = { skills: AvailableSkill[]; warnings: string[] };

// Anchor to the start of the file and stop at the first closing delimiter.
const skillFrontmatterPattern = String.raw`\A(?:\x{FEFF})?---[ \t]*\r?\n(?:[^\r\n]*\r?\n)*?---[ \t]*(?:\r?\n|\z)`;
const ripgrepTextSchema = z.union([
  z.object({ text: z.string() }).transform(({ text }) => text),
  z
    .object({ bytes: z.string() })
    .transform(({ bytes }) => Buffer.from(bytes, "base64").toString("utf-8")),
]);
const skillMatchSchema = z.object({
  data: z.object({ path: ripgrepTextSchema, lines: ripgrepTextSchema }),
});
const matchEventSchema = z.object({ type: z.literal("match") });
const skillsDirectory = `${appDirectory}/.agents/skills`;

/** List skill metadata and absolute paths from the app's skills directory. */
export async function getAvailableSkills(
  sandbox: SandboxSession,
  abortSignal?: AbortSignal,
): Promise<SkillCatalog> {
  const args = [
    "rg",
    "--no-config",
    "--multiline",
    "--json",
    "--only-matching",
    "--hidden",
    "--no-ignore",
    "--sort",
    "path",
    "--glob",
    "SKILL.md",
    "--",
    skillFrontmatterPattern,
    skillsDirectory,
  ];
  const command = `if [ -d ${quote(skillsDirectory)} ]; then ${args.map(quote).join(" ")}; fi`;
  const result = await sandbox.run({ command, abortSignal });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new FatalError(`Skill discovery failed: ${result.stderr || `exit ${result.exitCode}`}`);
  }

  const skills: AvailableSkill[] = [];
  const warnings: string[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line) {
      continue;
    }
    const event: unknown = JSON.parse(line);
    if (!matchEventSchema.safeParse(event).success) {
      continue;
    }
    const { data } = skillMatchSchema.parse(event);
    const frontmatter = data.lines
      .replace(/^\uFEFF?---[ \t]*\r?\n/u, "")
      .replace(/(?:\r?\n)---[ \t]*(?:\r?\n)?$/u, "");
    try {
      const metadata = skillMetadataSchema.parse(parseYaml(frontmatter));
      skills.push({ path: data.path, ...metadata });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Skipped invalid skill frontmatter: ${data.path}: ${message}`);
    }
  }
  return { skills, warnings };
}

/** Serialize workspace-authored metadata as data, without adding instructions. */
export function formatSkills(catalog: SkillCatalog): string {
  return JSON.stringify({ type: "untrusted-skill-catalog", ...catalog }, null, 2);
}
