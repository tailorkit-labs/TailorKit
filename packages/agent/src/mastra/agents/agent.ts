import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gateway } from "@ai-sdk/gateway";
import { SandboxFilesystem } from "@mastra/code-sdk/agents/sandbox-filesystem";
import { createCodingAgent } from "@mastra/core/coding-agent";
import { parseMemoryRequestContext } from "@mastra/core/memory";
import { MASTRA_THREAD_ID_KEY, type RequestContext } from "@mastra/core/request-context";
import { askUserTool, webFetchTool } from "@mastra/core/tools";
import { Workspace, type SandboxStartHook } from "@mastra/core/workspace";
import { DockerSandbox } from "@mastra/docker";
import { Memory } from "@mastra/memory";
import { VercelSandbox } from "@mastra/vercel";
import * as z from "zod";
import { env } from "../../env";
import { createAgentPrompt } from "./prompt";

const isVercelDeployment = env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
const requestContextSchema = z
  .object({
    "tailorkit-host-url": z.url({ protocol: /^https?$/u }),
  })
  .passthrough();
const findLocalWorkspacesPath = (): string => {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string };
      if (manifest.name === "@tailorkit/agent") {
        return join(directory, "workspaces");
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Could not locate the TailorKit agent package directory.");
    }
    directory = parent;
  }
};
const localWorkspacesPath = isVercelDeployment ? "" : findLocalWorkspacesPath();
const sandboxWorkingDirectory = "/vercel/sandbox";
const sandboxTimeout = 600_000;
const tailorkitCliPath = "/tmp/tailorkit-cli/node_modules/.bin/tailorkit";
const appPath = `${sandboxWorkingDirectory}/app`;
const threadIdIn = (requestContext: RequestContext): string | undefined => {
  const controller = requestContext.get("controller") as { threadId?: unknown } | undefined;
  const threadId =
    controller?.threadId ??
    requestContext.get(MASTRA_THREAD_ID_KEY) ??
    parseMemoryRequestContext(requestContext)?.thread?.id;
  return typeof threadId === "string" && threadId ? threadId : undefined;
};

const threadIdFrom = (requestContext: RequestContext): string => {
  const threadId = threadIdIn(requestContext);
  if (!threadId) {
    throw new Error("A thread ID is required to select an agent workspace.");
  }
  return threadId;
};

const workspaceNameFor = (threadId: string, hostUrl: string): string => {
  const label = threadId.replaceAll(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 24);
  const hash = createHash("sha256").update(`${threadId}\0${hostUrl}`).digest("hex").slice(0, 8);
  return `${label || "thread"}-${hash}`;
};

const localWorkspaceFor = (threadId: string, hostUrl: string): string =>
  join(localWorkspacesPath, workspaceNameFor(threadId, hostUrl));

const prepareTailorkitWorkspace =
  (hostUrl: string): SandboxStartHook =>
  async ({ sandbox }) => {
    const executeCommand = sandbox.executeCommand?.bind(sandbox);
    if (!executeCommand) {
      throw new Error("The coding agent sandbox cannot install the TailorKit CLI.");
    }

    const installed = await executeCommand("test", ["-x", tailorkitCliPath]);
    if (!installed.success) {
      const result = await executeCommand(
        "npm",
        [
          "install",
          "--prefix",
          "/tmp/tailorkit-cli",
          "--no-audit",
          "--no-fund",
          "@tailorkit/cli@latest",
        ],
        { timeout: 300_000 },
      );
      if (!result.success) {
        throw new Error(`Failed to install the TailorKit CLI: ${result.stderr || result.stdout}`);
      }
    }

    const appExists = await executeCommand("test", ["-e", appPath]);
    if (appExists.success) {
      const projectExists = await executeCommand("test", ["-f", `${appPath}/package.json`]);
      if (!projectExists.success) {
        throw new Error(`The app directory exists without a package.json: ${appPath}`);
      }
      return;
    }

    const result = await executeCommand(
      tailorkitCliPath,
      [
        "init",
        ".",
        "--name",
        "app",
        "--host",
        hostUrl,
        "--package-manager",
        "npm",
        "--lint",
        "--format",
        "--no-install",
      ],
      { cwd: sandboxWorkingDirectory, timeout: 300_000 },
    );
    if (!result.success) {
      throw new Error(`Failed to scaffold the TailorKit app: ${result.stderr || result.stdout}`);
    }
  };

const createSandbox = (requestContext: RequestContext): DockerSandbox | VercelSandbox => {
  const threadId = threadIdFrom(requestContext);
  const hostUrl = requestContext.get("tailorkit-host-url") as string;
  const name = workspaceNameFor(threadId, hostUrl);
  const onStart = prepareTailorkitWorkspace(hostUrl);
  if (isVercelDeployment) {
    return new VercelSandbox({
      id: name,
      sandboxName: name,
      runtime: "node24",
      timeout: sandboxTimeout,
      workingDirectory: sandboxWorkingDirectory,
      onStart,
    });
  }

  const localPath = localWorkspaceFor(threadId, hostUrl);
  mkdirSync(localPath, { recursive: true });
  return new DockerSandbox({
    id: name,
    image: "node:24",
    timeout: sandboxTimeout,
    workingDirectory: sandboxWorkingDirectory,
    volumes: { [localPath]: sandboxWorkingDirectory },
    onStart,
  });
};

export const workspace: Workspace = new Workspace({
  id: "agent-workspace",
  name: "Agent Workspace",
  filesystem: ({ requestContext }) =>
    new SandboxFilesystem({
      sandbox: {
        id: "agent-sandbox",
        executeCommand: async (command, args, options) => {
          const sandbox = await workspace.resolveSandbox({ requestContext });
          if (!sandbox?.executeCommand) {
            throw new Error("The current chat has no executable sandbox.");
          }
          return sandbox.executeCommand(command, args, options);
        },
      },
      workdir: sandboxWorkingDirectory,
    }),
  sandbox: ({ requestContext }) => createSandbox(requestContext),
  sandboxCacheKey: ({ requestContext }) => {
    const threadId = threadIdIn(requestContext);
    return threadId
      ? workspaceNameFor(threadId, requestContext.get("tailorkit-host-url") as string)
      : undefined;
  },
  instructions: {
    dynamicSandbox: ({ requestContext }) => {
      const threadId = threadIdIn(requestContext);
      if (!threadId) {
        return "Each chat has its own workspace.";
      }
      return isVercelDeployment
        ? `The current chat's workspace is ${sandboxWorkingDirectory}.`
        : `The current chat's files are visible at ${pathToFileURL(`${localWorkspaceFor(threadId, requestContext.get("tailorkit-host-url") as string)}/`).href}.`;
    },
  },
  tools: {
    requireApproval: false,
  },
});

export const agent = createCodingAgent({
  id: "agent",
  name: "TailorKit Coding Agent",
  description:
    "A coding agent that builds and iterates on TailorKit apps in an isolated workspace.",
  instructions: createAgentPrompt(appPath),
  requestContextSchema,
  model: gateway("xiaomi/mimo-v2.6-pro"),
  defaultOptions: {
    maxSteps: 100,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
      observationalMemory: {
        model: gateway("google/gemini-2.5-flash"),
      },
    },
  }),
  workspace,
  tools: {
    ask_user: askUserTool,
    web_fetch: webFetchTool,
  },
});
