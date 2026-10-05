import { tool } from "ai";
import { z } from "zod";
import { ensureSandbox, quote, resolvePath, searchResultSchema } from "./utils";

const outputSchema = searchResultSchema.extend({
  entries: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["file", "directory", "symlink", "other"]),
    }),
  ),
});

// GNU ls preserves filenames with NUL delimiters; shell tests avoid ambiguous
// type indicators and long-format output (especially for symlink targets).
const listScript = String.raw`
set -o pipefail
ls -AU --zero |
while IFS= read -r -d '' name; do
  if [[ -L "$name" ]]; then
    type=symlink
  elif [[ -d "$name" ]]; then
    type=directory
  elif [[ -f "$name" ]]; then
    type=file
  else
    type=other
  fi
  printf '%s\t%s\0' "$type" "$name"
done
`;

export const lsTool = tool({
  description: "List immediate directory entries, including hidden entries.",
  inputSchema: z.object({
    path: z
      .string()
      .default(".")
      .describe("Relative to /workspace/app, or an absolute path. Defaults to /workspace/app."),
    limit: z.number().int().positive().optional().default(500),
  }),
  outputSchema,
  execute: async ({ path, limit }, { experimental_sandbox, abortSignal }) => {
    "use step";
    ensureSandbox(experimental_sandbox);
    const result = await experimental_sandbox.run({
      command: `CDPATH= cd -- ${quote(resolvePath(path))} || exit\n${listScript}`,
      abortSignal,
    });
    const entries =
      result.exitCode === 0
        ? result.stdout
            .split("\0")
            .filter(Boolean)
            .map((record) => {
              const separator = record.indexOf("\t");
              return { type: record.slice(0, separator), name: record.slice(separator + 1) };
            })
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        : [];
    return outputSchema.parse({
      entries: entries.slice(0, limit),
      truncated: entries.length > limit,
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
  },
});
