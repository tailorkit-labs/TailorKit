import { tool } from "ai";
import { FatalError } from "workflow";
import { z } from "zod";
import { ensureSandbox, fileChangeResultSchema, resolvePath } from "./utils";

export const editTool = tool({
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
  execute: async ({ path, edits }, { experimental_sandbox, abortSignal }) => {
    "use step";
    ensureSandbox(experimental_sandbox);
    path = resolvePath(path);

    const file = await experimental_sandbox.readTextFile({ path, abortSignal });
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
    // Input order may differ from the order of matches in the file.
    matches.sort((left, right) => left.index - right.index);

    // Copy untouched spans, advancing past each replaced range in the original file.
    const parts: string[] = [];
    let cursor = 0;
    for (const match of matches) {
      if (match.index < cursor) {
        throw new FatalError(`Edit overlaps an earlier edit: edits[${match.editIndex}]`);
      }
      parts.push(file.slice(cursor, match.index), match.newText);
      cursor = match.index + match.oldText.length;
    }
    parts.push(file.slice(cursor));

    await experimental_sandbox.writeTextFile({
      path,
      content: parts.join(""),
      abortSignal,
    });
    return { success: true, path };
  },
});
