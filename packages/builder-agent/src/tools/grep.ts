import { tool } from "ai";
import { z } from "zod";
import { appDirectory, ensureSandbox, quote, searchResultSchema } from "./utils";

type RipgrepText = { text?: string; bytes?: string };
type RipgrepEvent =
  | {
      type: "match" | "context";
      data: { path: RipgrepText; lines: RipgrepText; line_number: number };
    }
  | { type: "begin" | "end" | "summary" };

function decodeText(value: RipgrepText) {
  return value.text ?? Buffer.from(value.bytes ?? "", "base64").toString("utf8");
}

const lineSchema = z.object({ line: z.number().int().positive(), text: z.string() });
const matchSchema = lineSchema.extend({
  path: z.string(),
  context: z.object({ before: z.array(lineSchema), after: z.array(lineSchema) }).optional(),
});
const outputSchema = searchResultSchema.extend({ matches: z.array(matchSchema) });

function parseResults(stdout: string, limit: number, context: number) {
  const matches: z.infer<typeof matchSchema>[] = [];
  const files = new Map<
    string,
    { lines: Map<number, string>; firstLine: number; lastLine: number }
  >();
  let truncated = false;

  for (const json of stdout.split("\n")) {
    if (!json) continue;
    const event = JSON.parse(json) as RipgrepEvent;
    if (event.type !== "match" && event.type !== "context") continue;

    const path = decodeText(event.data.path).replace(/^\.\//, "");
    const line = event.data.line_number;
    const text = decodeText(event.data.lines).replace(/\r?\n$/, "");
    if (context > 0) {
      let file = files.get(path);
      if (!file) {
        file = { lines: new Map(), firstLine: line, lastLine: line };
        files.set(path, file);
      }
      file.lines.set(line, text);
      file.firstLine = Math.min(file.firstLine, line);
      file.lastLine = Math.max(file.lastLine, line);
    }
    if (event.type === "match") {
      if (matches.length < limit) matches.push({ path, line, text });
      else truncated = true;
    }
  }

  // Attach context to each selected match; context does not consume the match limit.
  if (context > 0) {
    for (const match of matches) {
      const file = files.get(match.path);
      if (!file) continue;
      const before: z.infer<typeof lineSchema>[] = [];
      const after: z.infer<typeof lineSchema>[] = [];
      // Clamp to emitted lines so large context values do not scan beyond EOF.
      const firstLine = Math.max(file.firstLine, match.line - context);
      const lastLine = Math.min(file.lastLine, match.line + context);
      for (let line = firstLine; line <= lastLine; line++) {
        const text = file.lines.get(line);
        if (text === undefined || line === match.line) continue;
        (line < match.line ? before : after).push({ line, text });
      }
      match.context = { before, after };
    }
  }
  return { matches, truncated };
}

export const grepTool = tool({
  description:
    "Search text using a ripgrep regex or literal pattern, including hidden files. Globs can override ignore rules. Returns matching lines and context; exit 1 means no matches.",
  inputSchema: z.object({
    pattern: z.string(),
    path: z
      .string()
      .optional()
      .default(".")
      .describe("Relative to /workspace/app, or an absolute path. Defaults to /workspace/app."),
    glob: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional()
      .describe(
        "File filter(s) relative to /workspace/app; *.ts matches at any depth. Prefix ! excludes; later rules win.",
      ),
    ignoreCase: z.boolean().optional().default(false),
    literal: z.boolean().optional().default(false),
    context: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .default(0)
      .describe("Lines before and after each match."),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(100)
      .describe("Maximum matching lines across all files, excluding context."),
  }),
  outputSchema,
  execute: async (input, { experimental_sandbox, abortSignal }) => {
    "use step";

    ensureSandbox(experimental_sandbox);
    const args = [
      "rg",
      "--no-config",
      "--json",
      "--hidden",
      "--sort",
      "path",
      "--crlf",
      "--context",
      String(input.context),
      "--max-count",
      String(input.limit + 1),
    ];
    if (input.ignoreCase) args.push("--ignore-case");
    if (input.literal) args.push("--fixed-strings");
    if (input.glob) {
      for (const glob of Array.isArray(input.glob) ? input.glob : [input.glob]) {
        args.push("--glob", glob);
      }
    }
    // A bare '-' is ripgrep's stdin operand, even after '--'.
    args.push("--", input.pattern, input.path === "-" ? "./-" : input.path);

    const result = await experimental_sandbox.run({
      command: args.map(quote).join(" "),
      workingDirectory: appDirectory,
      abortSignal,
    });
    const parsed = parseResults(result.stdout, input.limit, input.context);
    return {
      ...parsed,
      exitCode: result.exitCode,
      stderr: result.stderr,
    };
  },
});
