import { tool } from "ai";
import type { Experimental_SandboxProcess as SandboxProcess } from "ai";
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

const maxOutputBytes = 1_048_576;
const maxStderrBytes = 65_536;

// `rg --max-count` is per file. Stop the process after the first extra match,
// allowing just enough trailing output to complete the selected matches' context.
async function collectResults(process: SandboxProcess, limit: number, context: number) {
  const lines: string[] = [];
  let truncated = false;
  let stopped = false;
  let stoppedExitCode = 0;
  const stop = async (exitCode = 0) => {
    stoppedExitCode = Math.max(stoppedExitCode, exitCode);
    truncated = true;
    if (stopped) return;
    stopped = true;
    await process.kill();
  };

  const stdout = async () => {
    const reader = process.stdout.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let bytes = 0;
    let count = 0;
    let lastMatch: { path: string; line: number } | undefined;
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        const remaining = maxOutputBytes - bytes;
        bytes += value.byteLength;
        pending += decoder.decode(value.subarray(0, remaining), { stream: true });
        let newline: number;
        while (!stopped && (newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line) as RipgrepEvent;
          if (event.type === "end" && count > limit) {
            await stop();
            break;
          }
          if (event.type !== "match" && event.type !== "context") continue;
          const path = decodeText(event.data.path);
          const number = event.data.line_number;
          if (event.type === "match" && ++count <= limit) {
            lastMatch = { path, line: number };
          }
          if (count <= limit || (path === lastMatch?.path && number <= lastMatch.line + context)) {
            lines.push(line);
          }
          if (count > limit && (path !== lastMatch?.path || number >= lastMatch.line + context)) {
            await stop();
          }
        }
        // Bound even a single huge JSON event, before buffering/parsing it.
        if (bytes > maxOutputBytes) await stop();
      }
    } finally {
      reader.releaseLock();
    }
  };

  const stderr = async () => {
    const reader = process.stderr.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const remaining = Math.max(0, maxStderrBytes - bytes);
        bytes += value.byteLength;
        text += decoder.decode(value.subarray(0, remaining), { stream: true });
        if (bytes > maxStderrBytes) {
          await stop(2);
          break;
        }
      }
      return text + (bytes > maxStderrBytes ? "" : decoder.decode());
    } finally {
      reader.releaseLock();
    }
  };

  try {
    const [, error] = await Promise.all([stdout(), stderr()]);
    const { exitCode } = await process.wait();
    const parsed = parseResults(lines.join("\n"), limit, context);
    return {
      ...parsed,
      truncated: truncated || parsed.truncated,
      // Suppress only normal rg statuses and signals caused by our own kill.
      // Genuine command failures must still survive match/output truncation.
      exitCode:
        stopped && [0, 1, 137, 141, 143].includes(exitCode)
          ? Math.max(stoppedExitCode, error ? 2 : 0)
          : exitCode,
      stderr: error,
    };
  } catch (error) {
    await process.kill();
    throw error;
  }
}

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

    if (event.type === "match" && matches.length === limit) {
      truncated = true;
      if (context === 0) break;
    }
    const path = decodeText(event.data.path).replace(/^\.\//, "");
    const line = event.data.line_number;
    // After the extra match, only consume trailing context for selected results.
    if (truncated) {
      const lastMatch = matches[matches.length - 1]!;
      if (path !== lastMatch.path || line > lastMatch.line + context) break;
    }
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
      .max(20)
      .optional()
      .default(0)
      .describe("Lines before and after each match, at most 20."),
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

    const process = await experimental_sandbox.spawn({
      command: args.map(quote).join(" "),
      workingDirectory: appDirectory,
      abortSignal,
    });
    return collectResults(process, input.limit, input.context);
  },
});
