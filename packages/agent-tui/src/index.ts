import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface AgentTuiOptions {
  hostUrl: string;
  token: string;
}

/** OpenTUI currently needs Bun (or Node 26 with experimental FFI). */
export async function runAgentTui(options: AgentTuiOptions): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("tailorkit agent needs an interactive terminal.");
  }
  const entry = fileURLToPath(new URL("./tui.mjs", import.meta.url));

  await new Promise<void>((resolve, reject) => {
    const child = spawn("bun", [entry], {
      stdio: "inherit",
      env: {
        ...process.env,
        TAILORKIT_AGENT_HOST_URL: options.hostUrl,
        TAILORKIT_AGENT_DEPLOY_TOKEN: options.token,
      },
    });
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
