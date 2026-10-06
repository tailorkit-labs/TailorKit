import { tool } from "ai";
import { z } from "zod";
import { sandboxContextSchema, toolSandbox, fileChangeResultSchema, resolvePath } from "./utils";

export const writeTool = tool({
  contextSchema: sandboxContextSchema,
  description: "Create or overwrite a text file, creating parent directories.",
  inputSchema: z.object({
    path: z.string().min(1).describe("Relative to /workspace/app, or an absolute path."),
    content: z.string(),
  }),
  outputSchema: fileChangeResultSchema,
  execute: async ({ path, content }, options) => {
    "use step";
    const sandbox = await toolSandbox(options);
    const { abortSignal } = options;
    path = resolvePath(path);
    await sandbox.writeTextFile({ path, content, abortSignal });
    return { success: true, path };
  },
});
