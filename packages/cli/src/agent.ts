import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createTailorKitClient } from "@tailorkit/core/server";
import { getDeployToken, NotLoggedInError, resolveHostUrl, runWhoami } from "./auth";

interface AgentOptions {
  configPath?: string;
  cwd: string;
  onLoginRequired?: () => Promise<unknown>;
}

export const supportsOpenTui = (versions: { bun?: string; node: string }): boolean => {
  const [major = 0, minor = 0] = (versions.bun ?? versions.node).split(".").map(Number);
  if (versions.bun) return major > 1 || (major === 1 && minor >= 3);
  return major > 26 || (major === 26 && minor >= 4);
};

/** Keep other CLI commands usable on Node 24; OpenTUI also supports Bun. */
export async function runAgentCommand(options: AgentOptions) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("tailorkit agent requires an interactive terminal.");
  }
  if (!supportsOpenTui(process.versions)) {
    if (process.versions.bun)
      throw new Error("OpenTUI requires Bun >=1.3. Update Bun, then run tailorkit agent again.");
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn("bun", [process.argv[1]!, ...process.argv.slice(2)], {
        stdio: "inherit",
      });
      child.once("error", () =>
        reject(
          new Error(
            "OpenTUI requires Bun >=1.3 or Node >=26.4. Install Bun, then run tailorkit agent again.",
          ),
        ),
      );
      child.once("exit", (code) => resolve(code ?? 1));
    });
    process.exitCode = code;
    return;
  }

  const hostUrl = await resolveHostUrl(options);
  try {
    await runWhoami(options);
  } catch (error) {
    if (!(error instanceof NotLoggedInError) || !options.onLoginRequired) throw error;
    await options.onLoginRequired();
    await runWhoami(options);
  }
  const auth = await getDeployToken(hostUrl);
  if (!auth) throw new NotLoggedInError(hostUrl);
  const client = createTailorKitClient({
    url: hostUrl,
    headers: { authorization: `Bearer ${auth.deployToken}` },
  });
  const { openAgentTui } = await import("./agent-tui");
  await openAgentTui({ client, hostUrl, sessionId: randomUUID() });
}
