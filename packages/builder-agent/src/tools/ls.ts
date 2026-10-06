import { tool } from "ai";
import { z } from "zod";
import { appDirectory, commandResultSchema, ensureSandbox, quote, resolvePath } from "./utils";

export const lsTool = tool({
  description: "List a directory with ls -la, including hidden entries and file details.",
  inputSchema: z.object({
    path: z.string().default(".").describe("Directory relative to /workspace/app, or absolute."),
  }),
  outputSchema: commandResultSchema,
  execute: async ({ path }, { experimental_sandbox, abortSignal }) => {
    "use step";
    ensureSandbox(experimental_sandbox);
    return experimental_sandbox.run({
      command: `ls -la -- ${quote(resolvePath(path))}`,
      workingDirectory: appDirectory,
      abortSignal,
    });
  },
});
