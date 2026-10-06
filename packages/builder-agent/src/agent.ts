import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import {
  tool,
  convertToModelMessages,
  type UIMessage,
  type InferToolOutput,
  type ToolExecutionOptions,
} from "ai";
import { getWritable } from "workflow";
import { Sandbox } from "@vercel/sandbox";
import { createVercelNetworkSandboxSessionFromNativeSandbox } from "@ai-sdk/sandbox-vercel";
import { z } from "zod";
import { readTool, writeTool, editTool, bashTool, grepTool, globTool, lsTool } from "./tools";
import { formatSkills, getAvailableSkills } from "./skills";
import instructions from "./instructions.md?raw";

async function prepareSandbox(name: string) {
  "use step";
  const nativeSandbox = await Sandbox.getOrCreate({
    name,
    image: "vercel/sandbox/universal",
    persistent: true,
    resume: true,
    timeout: 10 * 60 * 1000,
    snapshotExpiration: 24 * 60 * 60 * 1000,
    keepLastSnapshots: { count: 1 },
  });

  try {
    const sandbox = createVercelNetworkSandboxSessionFromNativeSandbox(nativeSandbox);
    const catalog = await getAvailableSkills(sandbox);
    // Native sandbox/session instances cannot cross workflow step boundaries.
    return { sandboxId: nativeSandbox.name, catalog };
  } catch (error) {
    // Stopping releases compute while preserving fresh and follow-up workspaces.
    try {
      await nativeSandbox.stop();
    } catch (cleanupError) {
      console.warn("Failed to stop sandbox after setup failure", cleanupError);
    }
    throw error;
  }
}

async function stopSandbox(sandboxId: string) {
  "use step";
  try {
    const sandbox = await Sandbox.get({ name: sandboxId });
    // Persistent sandboxes retain their filesystem when stopped.
    await sandbox.stop();
  } catch (error) {
    console.warn("Failed to stop sandbox after agent run", error);
  }
}

async function closeAgentStream(failed: boolean) {
  "use step";
  const writable = getWritable<ModelCallStreamPart>();
  if (failed) {
    const writer = writable.getWriter();
    try {
      await writer.write({ type: "error", error: "The builder agent failed." });
    } finally {
      writer.releaseLock();
    }
  }
  await writable.close();
}

const sandboxContextSchema = z.object({ sandboxId: z.string().min(1) });

async function toolSandbox(options: ToolExecutionOptions<{ sandboxId: string }>) {
  const nativeSandbox = await Sandbox.get({ name: options.context.sandboxId, resume: true });
  return createVercelNetworkSandboxSessionFromNativeSandbox(nativeSandbox);
}

// Only tool input and the sandbox reference cross each step boundary. Reconnect
// the native session inside the step, then reuse the tool's existing implementation.
const sandboxTools = {
  read: tool({
    ...readTool,
    contextSchema: sandboxContextSchema,
    execute: async (input, options) => {
      "use step";
      const sandbox = await toolSandbox(options);
      return readTool.execute!(input, { ...options, experimental_sandbox: sandbox }) as Promise<
        InferToolOutput<typeof readTool>
      >;
    },
  }),
  write: tool({
    ...writeTool,
    contextSchema: sandboxContextSchema,
    execute: async (input, options) => {
      "use step";
      const sandbox = await toolSandbox(options);
      return writeTool.execute!(input, { ...options, experimental_sandbox: sandbox }) as Promise<
        InferToolOutput<typeof writeTool>
      >;
    },
  }),
  edit: tool({
    ...editTool,
    contextSchema: sandboxContextSchema,
    execute: async (input, options) => {
      "use step";
      const sandbox = await toolSandbox(options);
      return editTool.execute!(input, { ...options, experimental_sandbox: sandbox }) as Promise<
        InferToolOutput<typeof editTool>
      >;
    },
  }),
  bash: tool({
    ...bashTool,
    contextSchema: sandboxContextSchema,
    execute: async (input, options) => {
      "use step";
      const sandbox = await toolSandbox(options);
      return bashTool.execute!(input, { ...options, experimental_sandbox: sandbox }) as Promise<
        InferToolOutput<typeof bashTool>
      >;
    },
  }),
  grep: tool({
    ...grepTool,
    contextSchema: sandboxContextSchema,
    execute: async (input, options) => {
      "use step";
      const sandbox = await toolSandbox(options);
      return grepTool.execute!(input, { ...options, experimental_sandbox: sandbox }) as Promise<
        InferToolOutput<typeof grepTool>
      >;
    },
  }),
  glob: tool({
    ...globTool,
    contextSchema: sandboxContextSchema,
    execute: async (input, options) => {
      "use step";
      const sandbox = await toolSandbox(options);
      return globTool.execute!(input, { ...options, experimental_sandbox: sandbox }) as Promise<
        InferToolOutput<typeof globTool>
      >;
    },
  }),
  ls: tool({
    ...lsTool,
    contextSchema: sandboxContextSchema,
    execute: async (input, options) => {
      "use step";
      const sandbox = await toolSandbox(options);
      return lsTool.execute!(input, { ...options, experimental_sandbox: sandbox }) as Promise<
        InferToolOutput<typeof lsTool>
      >;
    },
  }),
};

export async function appAgent({
  messages,
  model,
  appId,
}: {
  messages: UIMessage[];
  model: string;
  appId: string;
}) {
  "use workflow";

  let sandboxId: string | undefined;
  let failed = true;
  try {
    const prepared = await prepareSandbox(`app-${appId}`);
    sandboxId = prepared.sandboxId;
    const context = { sandboxId };
    const agent = new WorkflowAgent({
      model,
      instructions: instructions.trim(),
      tools: sandboxTools,
      toolsContext: {
        read: context,
        write: context,
        edit: context,
        bash: context,
        grep: context,
        glob: context,
        ls: context,
      },
    });

    const result = await agent.stream({
      // Workspace-authored metadata belongs in a lower-priority data message,
      // never in the authoritative instructions.
      messages: [
        { role: "user", content: formatSkills(prepared.catalog) },
        ...(await convertToModelMessages(messages)),
      ],
      writable: getWritable<ModelCallStreamPart>(),
      preventClose: true,
    });
    failed = false;
    // WorkflowAgent returns the input history too; omit the temporary catalog
    // so follow-ups receive current discovery data without accumulating copies.
    return { messages: result.messages.slice(1), sandboxId };
  } finally {
    if (sandboxId) await stopSandbox(sandboxId);
    // End the response after cleanup, including failures before the model starts.
    await closeAgentStream(failed);
  }
}
