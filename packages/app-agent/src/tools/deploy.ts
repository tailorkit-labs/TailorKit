import { tool } from "ai";
import { z } from "zod";
import { sandboxIdleTimeoutMs } from "../sandbox";
import { commandResultSchema, sandboxContextSchema, toolNativeSandbox } from "./utils";

export const deployTool = tool({
  description:
    "Build, type-check, and publish the finished app to its authorized TailorKit app. No login or host access is needed. Call only after completing and verifying the requested changes.",
  contextSchema: sandboxContextSchema.extend({
    appId: z.string().min(1),
    deployToken: z.string().min(1),
    platformUrl: z.url(),
  }),
  inputSchema: z.strictObject({}),
  outputSchema: commandResultSchema,
  execute: async (_input, options) => {
    "use step";
    const { appId, deployToken, platformUrl } = options.context;
    try {
      const sandbox = await toolNativeSandbox(options);
      const result = await sandbox.runCommand({
        cmd: "pnpm",
        args: [
          "--dir",
          "/tmp/tailorkit-cli",
          "exec",
          "tailorkit",
          "deploy",
          "--cwd",
          "/workspace/app",
          "--app-id",
          appId,
          "--no-interactive",
        ],
        cwd: "/workspace/app",
        env: { TAILORKIT_DEPLOY_TOKEN: deployToken, TAILORKIT_PLATFORM_URL: platformUrl },
        signal: options.abortSignal,
        timeoutMs: sandboxIdleTimeoutMs,
      });
      const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
      // Never put credentials in the model stream, even if a subprocess echoes them.
      return {
        exitCode: result.exitCode,
        stdout: stdout.replaceAll(deployToken, "[redacted]"),
        stderr: stderr.replaceAll(deployToken, "[redacted]"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { exitCode: 1, stdout: "", stderr: message.replaceAll(deployToken, "[redacted]") };
    }
  },
});
