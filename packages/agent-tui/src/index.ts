import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface AgentTuiOptions {
  url?: string;
}

/** OpenTUI currently needs Bun (or Node 26 with experimental FFI). */
export async function runAgentTui(options: AgentTuiOptions = {}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("tailorkit agent needs an interactive terminal.");
  }
  const entry = fileURLToPath(new URL("./tui.mjs", import.meta.url));
  const args = [entry];
  if (options.url) args.push("--url", options.url);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("bun", args, { stdio: "inherit" });
    child.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "ENOENT"
          ? new Error("OpenTUI requires Bun 1.3 or newer. Install Bun and retry.")
          : error,
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Agent UI exited ${signal ? `from ${signal}` : `with code ${code}`}.`));
    });
  });
}
