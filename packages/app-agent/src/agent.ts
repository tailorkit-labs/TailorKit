import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { stepCountIs, type ModelMessage } from "ai";
import { getWorkflowMetadata, getWritable, sleep } from "workflow";
import { bashTool, editTool, globTool, grepTool, lsTool, readTool, writeTool } from "./tools";
import { deleteSandbox, prepareSandbox, renewSandbox } from "./sandbox";
import instructions from "./instructions.md?raw";

export interface AppAgentInput {
  /** Globally unique, authorized app identity within the Vercel project. */
  appId: string;
  messages: ModelMessage[];
  /** Serializable AI Gateway model ID. */
  model: string;
}

async function keepSandboxAlive(sandboxName: string, finished: Promise<boolean>) {
  while (!(await Promise.race([finished, sleep("5m").then(() => false)]))) {
    await renewSandbox(sandboxName);
  }
}

/** One editing turn. The Drive's exclusive mount rejects concurrent writers. */
export async function appAgent({ messages, model, appId }: AppAgentInput) {
  "use workflow";
  const sandboxName = `app-agent-${getWorkflowMetadata().workflowRunId}`;

  try {
    await prepareSandbox(`app-${appId}`, sandboxName);
    const context = { sandboxName };
    const agent = new WorkflowAgent({
      model,
      instructions: instructions.trim(),
      tools: {
        read: readTool,
        write: writeTool,
        edit: editTool,
        bash: bashTool,
        grep: grepTool,
        glob: globTool,
        ls: lsTool,
      },
      toolsContext: {
        read: context,
        write: context,
        edit: context,
        bash: context,
        grep: context,
        glob: context,
        ls: context,
      },
      stopWhen: stepCountIs(100),
    });
    const controller = new AbortController();
    const agentRun = agent.stream({
      messages,
      writable: getWritable<ModelCallStreamPart>(),
      abortSignal: controller.signal,
      // Bound a stalled agent without deleting its VM while it is still working.
      timeout: 30 * 60_000,
    });
    const finished = agentRun.then(
      () => true,
      () => true,
    );
    let renewalError: unknown;
    const keepAlive = keepSandboxAlive(sandboxName, finished).catch((error: unknown) => {
      renewalError = error;
      controller.abort();
    });
    let result: Awaited<typeof agentRun>;
    try {
      result = await agentRun;
    } finally {
      // Finish any in-flight renewal before releasing the Drive.
      await keepAlive;
    }
    if (renewalError) throw renewalError;
    if (result.error) throw result.error;
    return { messages: result.messages };
  } finally {
    // Never stop/snapshot between model calls or tool steps.
    await deleteSandbox(sandboxName);
  }
}
