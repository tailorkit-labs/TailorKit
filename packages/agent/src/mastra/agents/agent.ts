import { pathToFileURL } from "node:url";
import { gateway } from "@ai-sdk/gateway";
import { createCodingAgent } from "@mastra/core/coding-agent";
import { askUserTool, webFetchTool } from "@mastra/core/tools";
import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace } from "@mastra/core/workspace";
import { Memory } from "@mastra/memory";
import { VercelSandbox } from "@mastra/vercel";
import { env } from "#env";

const workspacePath = "workspace";
const isVercelDeployment = env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
const sandbox = isVercelDeployment
  ? new VercelSandbox({
      runtime: "node24",
      timeout: 600_000,
      workingDirectory: "/vercel/sandbox/workspace",
    })
  : new LocalSandbox({
      workingDirectory: workspacePath,
    });

export const workspace = new Workspace({
  id: "agent-workspace",
  name: "Agent Workspace",
  filesystem: new LocalFilesystem({
    basePath: workspacePath,
  }),
  sandbox,
  tools: {
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
      requireApproval: true,
    },
    [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: {
      requireApproval: true,
    },
  },
});

export const agent = createCodingAgent({
  id: "agent",
  name: "TailorKit Coding Agent",
  description:
    "A coding agent that builds and iterates on TailorKit apps in an isolated workspace.",
  metadata: {
    suggestedPrompts: [
      "Build a customer portal with sign-in and a dashboard.",
      "Improve the layout and accessibility of this TailorKit app.",
      "Add a responsive pricing page to the current project.",
    ],
  },
  instructions: `You are TailorKit's coding agent. Build and improve web applications from the user's requests by inspecting and editing the local workspace, running commands, and explaining the result. Keep changes scoped to the current project, preserve existing conventions, and ask concise questions only when a decision is needed to make progress.

Suggested prompts: Build a customer portal with sign-in and a dashboard; Improve the layout and accessibility of this app; Add a responsive pricing page.

When the user greets you or does not have a specific task, invite them to try the suggested prompts.

Ask concise questions when something is unclear or a good question could surface a useful insight.

For local file changes, end with a plain-text URL using ${pathToFileURL(`${workspacePath}/`).href}; avoid Markdown links, localhost, /workspace, relative paths, and static-file servers.
`,
  model: gateway("openai/gpt-6-luna"),
  defaultOptions: {
    maxSteps: 100,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
      observationalMemory: {
        model: gateway("openai/gpt-6-luna"),
      },
    },
  }),
  workspace,
  tools: {
    ask_user: askUserTool,
    web_fetch: webFetchTool,
  },
});
