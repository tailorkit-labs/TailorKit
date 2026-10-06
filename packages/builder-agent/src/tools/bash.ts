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
    timeoutMs: z.number().int().positive().max(2_147_483_647).default(30_000),
  }),
  outputSchema: commandResultSchema,
  execute: async ({ command, cwd, timeoutMs }, { experimental_sandbox, abortSignal }) => {
    "use step";
    ensureSandbox(experimental_sandbox);
    abortSignal?.throwIfAborted();

    const timeout = AbortSignal.timeout(timeoutMs);
    return experimental_sandbox.run({
      command,
      workingDirectory: resolvePath(cwd),
      abortSignal: abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout,
    });
  },
});
