import { tool } from "ai";
import { z } from "zod";
import {
  appDirectory,
  commandResultSchema,
  sandboxContextSchema,
  toolSandbox,
  quote,
  resolvePath,
} from "./utils";

export const lsTool = tool({
  contextSchema: sandboxContextSchema,
  description: "List a directory with ls -la, including hidden entries and file details.",
  inputSchema: z.object({
    path: z.string().default(".").describe("Directory relative to /workspace/app, or absolute."),
  }),
  outputSchema: commandResultSchema,
  execute: async ({ path }, options) => {
    "use step";
    const sandbox = await toolSandbox(options);
    const { abortSignal } = options;
    return sandbox.run({
      command: `ls -la -- ${quote(resolvePath(path))}`,
      workingDirectory: appDirectory,
      abortSignal,
    });
  },
});
