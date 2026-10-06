import { tool } from "ai";
import { z } from "zod";
import { sandboxContextSchema, toolSandbox, resolvePath } from "./utils";

export const readTool = tool({
  contextSchema: sandboxContextSchema,
  description: "Read a text file, optionally by line range. Returns null for a missing file.",
  inputSchema: z
    .object({
      path: z.string().min(1).describe("Relative to /workspace/app, or an absolute path."),
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
  execute: async ({ path, startLine, endLine }, options) => {
    "use step";
    const sandbox = await toolSandbox(options);
    const { abortSignal } = options;
    return sandbox.readTextFile({
      path: resolvePath(path),
      startLine,
      endLine,
      abortSignal,
    });
  },
});
