import { tool } from "ai";
import { z } from "zod";
import { commandResultSchema, ensureSandbox, resolvePath } from "./utils";

export const bashTool = tool({
  description: "Run a shell command; timeout defaults to 30s.",
  inputSchema: z.object({
    command: z.string().min(1),
    cwd: z
      .string()
      .optional()
      .describe("Relative to /workspace/app, or an absolute path. Defaults to /workspace/app."),
    timeoutMs: z.number().positive().max(2_147_483_647).optional().default(30_000),
  }),
  outputSchema: commandResultSchema,
  execute: async ({ command, cwd, timeoutMs }, { experimental_sandbox, abortSignal }) => {
    "use step";
    ensureSandbox(experimental_sandbox);
    abortSignal?.throwIfAborted();

    const abortController = new AbortController();
    const onAbort = () => abortController.abort(abortSignal?.reason);
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    const timeout = setTimeout(() => {
      abortController.abort(`timeout: ${timeoutMs}ms`);
    }, timeoutMs);

    try {
      return await experimental_sandbox.run({
        command,
        workingDirectory: resolvePath(cwd),
        abortSignal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", onAbort);
    }
  },
});
