import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { tool, type ModelMessage, type InferToolOutput, type ToolExecutionOptions } from "ai";
import { getWritable } from "workflow";
import { Sandbox } from "@vercel/sandbox";
import { createVercelNetworkSandboxSessionFromNativeSandbox } from "@ai-sdk/sandbox-vercel";
import { z } from "zod";
import { readTool, writeTool, editTool, bashTool, grepTool, globTool, lsTool } from "./tools";
import { formatSkills, getAvailableSkills } from "./skills";
import instructions from "./instructions.md?raw";

async function prepareSandbox(name: string, previousSandboxId?: string) {
  "use step";
  const nativeSandbox = previousSandboxId
    ? await Sandbox.get({ name: previousSandboxId, resume: true })
    : await Sandbox.getOrCreate({ name, image: "vercel/sandbox/universal", persistent: true });

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
  sandboxId: previousSandboxId,
}: {
  messages: ModelMessage[];
  model: string;
  appId: string;
  /** Pass the sandboxId returned by the previous run to continue its workspace. */
  sandboxId?: string;
}) {
  "use workflow";

  const { sandboxId, catalog } = await prepareSandbox(`app-${appId}`, previousSandboxId);
  const context = { sandboxId };

  try {
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
      messages: [{ role: "user", content: formatSkills(catalog) }, ...messages],
      writable: getWritable<ModelCallStreamPart>(),
    });
    // WorkflowAgent returns the input history too; omit the temporary catalog
    // so follow-ups receive current discovery data without accumulating copies.
    return { messages: result.messages.slice(1), sandboxId };
  } finally {
    // Also release compute on stream errors and cooperative aborts.
    await stopSandbox(sandboxId);
  }
}
