import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import type { LanguageModel, ModelMessage } from "ai";
import { getWorkflowMetadata, getWritable } from "workflow";
import { Sandbox } from "@vercel/sandbox";
import { createVercelNetworkSandboxSessionFromNativeSandbox } from "@ai-sdk/sandbox-vercel";
import { readTool, writeTool, editTool, bashTool, grepTool, globTool, lsTool } from "./tools";
import { formatSkills, getAvailableSkills } from "./skills";
import instructions from "./instructions.md?raw";

async function cleanUp({ sandboxId }: { sandboxId: string }) {
  "use step";
  const sandbox = await Sandbox.get({ name: sandboxId });
  // TODO - we should store the code to s3
  await sandbox.delete();
}

export async function appAgent({
  messages,
  model,
}: {
  messages: ModelMessage[];
  model: LanguageModel;
}) {
  "use workflow";

  const { workflowRunId, workflowName } = getWorkflowMetadata();

  const nativeSandbox = await Sandbox.getOrCreate({
    name: `${workflowName}:${workflowRunId}`,
    image: "vercel/sandbox/universal",
  });
  const sandbox = createVercelNetworkSandboxSessionFromNativeSandbox(nativeSandbox);

  const skills = await getAvailableSkills(sandbox);

  const agent = new WorkflowAgent({
    model,
    instructions: [instructions.trim(), formatSkills(skills)].join("\n\n"),
    experimental_sandbox: sandbox,
    tools: {
      read: readTool,
      write: writeTool,
      edit: editTool,
      bash: bashTool,
      grep: grepTool,
      glob: globTool,
      ls: lsTool,
    },
    onEnd: async () => {
      await cleanUp({ sandboxId: nativeSandbox.name });
    },
  });

  const result = await agent.stream({
    messages,
    writable: getWritable<ModelCallStreamPart>(),
  });

  return { messages: result.messages };
}
