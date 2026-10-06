import { tool } from "ai";
import { FatalError } from "workflow";
import { z } from "zod";
import { sandboxContextSchema, toolSandbox, fileChangeResultSchema, resolvePath } from "./utils";

export const editTool = tool({
  contextSchema: sandboxContextSchema,
  description:
    "Replace text in a file. Each oldText must match once in the original; edits must not overlap.",
  inputSchema: z.object({
    path: z.string().min(1).describe("Relative to /workspace/app, or an absolute path."),
    edits: z
      .array(
        z.object({
          oldText: z.string().min(1),
          newText: z.string(),
        }),
      )
      .min(1),
  }),
  outputSchema: fileChangeResultSchema,
  execute: async ({ path, edits }, options) => {
    "use step";
    const sandbox = await toolSandbox(options);
    const { abortSignal } = options;
    path = resolvePath(path);

    abortSignal?.throwIfAborted();
    const file = await sandbox.readTextFile({ path, abortSignal });
    if (file === null) throw new FatalError("File not found");

    // Match against the original file so replacement text cannot affect later edits.
    const matches = edits.map((edit, editIndex) => {
      const index = file.indexOf(edit.oldText);
      if (index < 0) throw new FatalError(`Text not found: ${edit.oldText}`);
      if (file.indexOf(edit.oldText, index + 1) >= 0) {
        throw new FatalError(`Text occurs more than once: ${edit.oldText}`);
      }
      return { ...edit, editIndex, index };
    });
    // Work backwards so earlier offsets remain valid after each replacement.
    matches.sort((left, right) => right.index - left.index);
    let content = file;
    let boundary = file.length;
    for (const match of matches) {
      if (match.index + match.oldText.length > boundary) {
        throw new FatalError(`Edit overlaps an earlier edit: edits[${match.editIndex}]`);
      }
      content =
        content.slice(0, match.index) +
        match.newText +
        content.slice(match.index + match.oldText.length);
      boundary = match.index;
    }

    abortSignal?.throwIfAborted();
    await sandbox.writeTextFile({
      path,
      content,
      abortSignal,
    });
    return { success: true, path };
  },
});
