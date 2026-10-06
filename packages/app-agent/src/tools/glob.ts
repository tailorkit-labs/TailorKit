import { tool } from "ai";
import { z } from "zod";
import {
  commandResultSchema,
  sandboxContextSchema,
  toolSandbox,
  quote,
  resolvePath,
} from "./utils";

export const globTool = tool({
  contextSchema: sandboxContextSchema,
  description: "Find files with a ripgrep glob, including hidden files. Returns one path per line.",
  inputSchema: z.object({
    pattern: z.string().min(1).describe("A ripgrep glob, such as *.ts or src/**/*.tsx."),
    path: z
      .string()
      .default(".")
      .describe("Search directory relative to /workspace/app, or absolute."),
  }),
  outputSchema: commandResultSchema,
  execute: async ({ pattern, path }, options) => {
    "use step";
    const sandbox = await toolSandbox(options);
    const { abortSignal } = options;
    return sandbox.run({
      command: `rg --no-config --files --hidden --glob ${quote(pattern)}`,
      workingDirectory: resolvePath(path),
      abortSignal,
    });
  },
});
