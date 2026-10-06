import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, type UIMessage, type LanguageModel } from "ai";
import { getWritable } from "workflow";
import { Sandbox } from "@vercel/sandbox";
import { createVercelNetworkSandboxSessionFromNativeSandbox } from "@ai-sdk/sandbox-vercel";
import { readTool, writeTool, editTool, bashTool, grepTool, globTool, lsTool } from "./tools";
import { formatSkills, getAvailableSkills } from "./skills";
import instructions from "./instructions.md?raw";

const sandboxRetentionMs = 24 * 60 * 60 * 1000;

async function prepareSandbox(name: string, previousSandboxId?: string) {
  "use step";
  const nativeSandbox = previousSandboxId
    ? await Sandbox.get({ name: previousSandboxId, resume: true })
    : await Sandbox.getOrCreate({
        name,
        image: "vercel/sandbox/universal",
        persistent: true,
        resume: true,
        snapshotExpiration: sandboxRetentionMs,
      });

  try {
    if (nativeSandbox.snapshotExpiration !== sandboxRetentionMs) {
      await nativeSandbox.update({ snapshotExpiration: sandboxRetentionMs });
    }
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

export async function appAgent({
  messages,
  model,
  appId,
  sandboxId: previousSandboxId,
}: {
  messages: UIMessage[];
  model: LanguageModel;
  appId: string;
  /** Pass the sandboxId returned by the previous run to continue its workspace. */
  sandboxId?: string;
}) {
  "use workflow";

  let sandboxId: string | undefined;
  let failed = true;
  try {
    const prepared = await prepareSandbox(`app-${appId}`, previousSandboxId);
    sandboxId = prepared.sandboxId;
    const context = { sandboxId };
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
