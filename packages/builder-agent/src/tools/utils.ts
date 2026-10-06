import { posix } from "node:path";
import { FatalError } from "workflow";
import type { Experimental_SandboxSession as SandboxSession, ToolExecutionOptions } from "ai";
import { Sandbox } from "@vercel/sandbox";
import { createVercelNetworkSandboxSessionFromNativeSandbox } from "@ai-sdk/sandbox-vercel";
import { z } from "zod";

export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export const appDirectory = "/workspace/app";

export const resolvePath = (path = ".") =>
  posix.isAbsolute(path) ? path : posix.resolve(appDirectory, path);

export const commandResultSchema = z.object({
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
});

export const fileChangeResultSchema = z.object({
  success: z.literal(true),
  path: z.string(),
});

export function ensureSandbox(sandbox?: SandboxSession): asserts sandbox is SandboxSession {
  if (!sandbox) throw new FatalError("Sandbox not available");
}

export const sandboxContextSchema = z
  .object({ sandboxId: z.string().min(1).optional() })
  .default({});

/** Resolve inside the tool step so native sandbox instances never cross step boundaries. */
export async function toolSandbox(
  options: ToolExecutionOptions<z.infer<typeof sandboxContextSchema>>,
) {
  const sandboxId = options.context?.sandboxId;
  if (sandboxId) {
    const nativeSandbox = await Sandbox.get({ name: sandboxId, resume: true });
    return createVercelNetworkSandboxSessionFromNativeSandbox(nativeSandbox);
  }
  ensureSandbox(options.experimental_sandbox);
  return options.experimental_sandbox;
}
