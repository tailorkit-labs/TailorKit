import { tool } from "ai";
import { z } from "zod";
import { ensureSandbox, resolvePath } from "./utils";

export const readTool = tool({
  description: "Read a text file, optionally by line range. Returns null for a missing file.",
  inputSchema: z
    .object({
      path: z.string().describe("Relative to /workspace/app, or an absolute path."),
      startLine: z
        .number()
        .int()
        .positive()
        .default(1)
        .optional()
        .describe("1-based inclusive start line."),
      endLine: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-based inclusive end line; clamps past EOF."),
    })
    .refine(({ startLine, endLine }) => endLine === undefined || endLine >= (startLine ?? 1), {
      message: "endLine must be at least startLine",
      path: ["endLine"],
    }),
  outputSchema: z.string().nullable(),
  execute: async ({ path, startLine, endLine }, { experimental_sandbox, abortSignal }) => {
    "use step";
    ensureSandbox(experimental_sandbox);
    return experimental_sandbox.readTextFile({
      path: resolvePath(path),
      startLine,
      endLine,
      abortSignal,
    });
  },
});
