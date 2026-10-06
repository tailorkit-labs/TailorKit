import { tool } from "ai";
import { z } from "zod";
import { appDirectory, commandResultSchema, ensureSandbox, quote, resolvePath } from "./utils";

export const grepTool = tool({
  description:
    "Search with ripgrep. Returns matching lines with filenames and line numbers; exit 1 means no matches.",
  inputSchema: z.object({
    pattern: z.string().min(1),
    path: z
      .string()
      .default(".")
      .describe("File or directory relative to /workspace/app, or absolute."),
    glob: z.string().min(1).optional().describe("An optional ripgrep file glob, such as *.ts."),
    ignoreCase: z.boolean().default(false),
    literal: z.boolean().default(false),
  }),
  outputSchema: commandResultSchema,
  execute: async (
    { pattern, path, glob, ignoreCase, literal },
    { experimental_sandbox, abortSignal },
  ) => {
    "use step";
    ensureSandbox(experimental_sandbox);
    const args = [
      "rg",
      "--no-config",
      "--line-number",
      "--with-filename",
      "--color",
      "never",
      "--hidden",
    ];
    if (ignoreCase) args.push("--ignore-case");
    if (literal) args.push("--fixed-strings");
    if (glob) args.push("--glob", glob);
    args.push("--", pattern, resolvePath(path));
    return experimental_sandbox.run({
      command: args.map(quote).join(" "),
      workingDirectory: appDirectory,
      abortSignal,
    });
  },
});
