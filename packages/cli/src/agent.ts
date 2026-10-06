import { randomUUID } from "node:crypto";
import { createTailorKitClient } from "@tailorkit/core/server";
import { getDeployToken, NotLoggedInError, resolveHostUrl, runWhoami } from "./auth";

interface AgentOptions {
  configPath?: string;
  cwd: string;
  onLoginRequired?: () => Promise<unknown>;
}

export async function runAgentCommand(options: AgentOptions) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("tailorkit agent requires an interactive terminal.");
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
