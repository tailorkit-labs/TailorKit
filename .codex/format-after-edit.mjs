import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const event = JSON.parse(readFileSync(0, "utf8"));
const command = event.tool_input?.command ?? "";

function editsFiles() {
  if (["apply_patch", "Edit", "Write"].includes(event.tool_name)) return true;
  if (event.tool_name !== "Bash") return false;

  return (
    /apply_patch[\s\S]*\*\*\* Begin Patch/.test(command) ||
    /\b(?:cat|tee)\b[\s\S]*?(?:<<[\s\S]*?>|>\s*\S)/.test(command) ||
    /\btee\s+(?:-[a-z]+\s+)*\S+/.test(command) ||
    /\b(?:cp|mv|install|touch|truncate|patch)\s+/.test(command) ||
    /\bgit\s+apply\b/.test(command) ||
    /\b(?:sed|perl)\s+-[^\n]*i(?:\s|$)/.test(command) ||
    /\b(?:python\w*|node)\b[\s\S]*(?:writeFile|write_text|open\([^\n]*["']w)/.test(
      command,
    ) ||
    /(?:^|\s)[^\n]*\s>{1,2}\s*[^&\s]/.test(command)
  );
}

if (!editsFiles()) process.exit(0);

const cwd = event.cwd ?? process.cwd();
const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd,
  encoding: "utf8",
}).trim();
const result = spawnSync("pnpm", ["fix"], {
  cwd: gitRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Codex formatting hook failed: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
