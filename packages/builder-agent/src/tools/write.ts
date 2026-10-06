import { tool } from "ai";
import { z } from "zod";
import { ensureSandbox, fileChangeResultSchema, resolvePath } from "./utils";

export const writeTool = tool({
  description: "Create or overwrite a text file, creating parent directories.",
  inputSchema: z.object({
    path: z.string().min(1).describe("Relative to /workspace/app, or an absolute path."),
    content: z.string(),
  }),
  outputSchema: fileChangeResultSchema,
  execute: async ({ path, content }, { experimental_sandbox, abortSignal }) => {
    "use step";
    ensureSandbox(experimental_sandbox);
    path = resolvePath(path);
    await experimental_sandbox.writeTextFile({ path, content, abortSignal });
    return { success: true, path };
  },
});
