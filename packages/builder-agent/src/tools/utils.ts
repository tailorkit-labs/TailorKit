import { posix } from "node:path";
import { FatalError } from "workflow";
import type { Experimental_SandboxSession as SandboxSession } from "ai";
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

export const searchResultSchema = z.object({
  exitCode: z.number(),
  stderr: z.string(),
  truncated: z.boolean(),
});

export function ensureSandbox(sandbox?: SandboxSession): asserts sandbox is SandboxSession {
  if (!sandbox) throw new FatalError("Sandbox not available");
}
