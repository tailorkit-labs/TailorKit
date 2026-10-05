import { tool } from "ai";
import { FatalError } from "workflow";
import { z } from "zod";
import { ensureSandbox, fileChangeResultSchema, quote, resolvePath } from "./utils";

// The universal sandbox image provides Node and util-linux flock. Keep the whole
// read/validate/write operation in the locked process, including across workers.
const editScript = String.raw`
const { readFileSync, writeFileSync } = require("node:fs");
const { path, edits } = JSON.parse(process.argv[1]);
try {
    const file = readFileSync(path, "utf8");

    // Match against the original file so replacement text cannot affect later edits.
    const matches = edits.map((edit, editIndex) => {
      const index = file.indexOf(edit.oldText);
      if (index < 0) throw new Error("Text not found: " + edit.oldText);
      if (file.indexOf(edit.oldText, index + 1) >= 0) {
        throw new Error("Text occurs more than once: " + edit.oldText);
      }
      return { ...edit, editIndex, index };
    });
    // Input order may differ from the order of matches in the file.
    matches.sort((left, right) => left.index - right.index);

    // Copy untouched spans, advancing past each replaced range in the original file.
    const parts = [];
    let cursor = 0;
    for (const match of matches) {
      if (match.index < cursor) {
        throw new Error("Edit overlaps an earlier edit: edits[" + match.editIndex + "]");
      }
      parts.push(file.slice(cursor, match.index), match.newText);
      cursor = match.index + match.oldText.length;
    }
    parts.push(file.slice(cursor));

    writeFileSync(path, parts.join(""), "utf8");
} catch (error) {
  process.stderr.write(error.code === "ENOENT" ? "File not found" : error.message);
  process.exitCode = 1;
}
`;

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

    abortSignal?.throwIfAborted();
    const target = quote(path);
    const process = await experimental_sandbox.spawn({
      // Lock the file itself so symlink/path aliases share the same inode lock.
      // --no-fork leaves the lock held by Node and releases it on errors/abort.
      command: `[[ -f ${target} ]] || { printf '%s' 'File not found' >&2; exit 1; }
exec flock --exclusive --timeout 30 --no-fork ${target} node -e ${quote(editScript)} ${quote(JSON.stringify({ path, edits }))}`,
      abortSignal,
    });
    let finished = false;
    let stopping: Promise<void> | undefined;
    const stop = () => {
      if (finished) return Promise.resolve();
      return (stopping ??= Promise.resolve(process.kill()));
    };
    const onAbort = () => {
      void stop().catch(() => {});
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    try {
      abortSignal?.throwIfAborted();
      const [, stderr, result] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.wait(),
      ]);
      finished = true;
      abortSignal?.throwIfAborted();
      if (result.exitCode !== 0) {
        throw new FatalError(stderr.trim() || "Failed to acquire file lock or edit file");
      }
      return { success: true, path };
    } catch (error) {
      try {
        await stop();
      } catch (cleanupError) {
        console.warn("Failed to stop edit command", cleanupError);
      }
      if (abortSignal?.aborted) throw abortSignal.reason;
      throw error;
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
    }
  },
});
