import { tool } from "ai";
import { z } from "zod";
import { ensureSandbox, quote, resolvePath, searchResultSchema } from "./utils";

const outputSchema = searchResultSchema.extend({ paths: z.array(z.string()) });
const limit = 200;

export const globTool = tool({
  description:
    "Find files by glob relative to the search directory. Includes hidden files; globs can override ignore rules. Returns up to 200 paths with a truncated flag.",
  inputSchema: z.object({
    pattern: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .describe("Relative glob(s); use **/ for nested files. Prefix ! excludes; later rules win."),
    path: z
      .string()
      .default(".")
      .describe("Relative to /workspace/app, or an absolute path. Defaults to /workspace/app."),
  }),
  outputSchema,
  execute: async ({ pattern, path }, { experimental_sandbox, abortSignal }) => {
    "use step";
    ensureSandbox(experimental_sandbox);
    const args = ["rg", "--no-config", "--files", "--null", "--hidden", "--sort", "path"];
    for (const glob of Array.isArray(pattern) ? pattern : [pattern]) {
      const exclude = glob.startsWith("!");
      const relative = (exclude ? glob.slice(1) : glob).replace(/^\.\//, "").replace(/^\//, "");
      args.push("--glob", (exclude ? "!/" : "/") + relative);
    }
    const result = await experimental_sandbox.run({
      command: [
        "set -o pipefail",
        // Cap NUL-delimited paths before the sandbox buffers stdout.
        `${args.map(quote).join(" ")} | (count=0; while IFS= read -r -d '' path; do printf '%s\\0' "$path" || exit $?; count=$((count + 1)); if [ "$count" -ge ${limit + 1} ]; then break; fi; done; exit 0)`,
        'statuses=("${PIPESTATUS[@]}")',
        // The cap can close the pipe while ripgrep is still writing (SIGPIPE).
        'if [ "${statuses[1]}" -ne 0 ]; then exit "${statuses[1]}"; fi',
        'if [ "${statuses[0]}" -eq 141 ]; then exit 0; fi',
        'exit "${statuses[0]}"',
      ].join("\n"),
      workingDirectory: resolvePath(path),
      abortSignal,
    });
    // NUL delimiters preserve paths containing spaces, tabs, and newlines.
    const paths = result.stdout
      .split("\0")
      .filter(Boolean)
      .map((path) => path.replace(/^\.\//, ""));
    return {
      paths: paths.slice(0, limit),
      truncated: paths.length > limit,
      exitCode: result.exitCode,
      stderr: result.stderr,
    };
  },
});
