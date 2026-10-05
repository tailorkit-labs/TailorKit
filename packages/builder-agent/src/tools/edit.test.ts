import { spawn as nativeSpawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import type { Experimental_SandboxSession as SandboxSession } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { editTool } from "./edit";

const filePath = "/workspace/app.txt";
const flockProbe = spawnSync("flock", ["--help"], { encoding: "utf8" });
const hasFlock = flockProbe.status === 0 && flockProbe.stdout.includes("--no-fork");
let root: string;
let commands: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "builder-edit-"));
  commands = join(root, ".commands");
  mkdirSync(commands);
  mkdirSync(join(root, "app"));
  if (!hasFlock) {
    // Exercise the actual edit script on macOS; Linux-only locking tests skip below.
    writeFileSync(join(commands, "flock"), '#!/bin/sh\nshift 5\nexec "$@"\n', { mode: 0o755 });
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

type Edits = { oldText: string; newText: string }[];

function execute(
  run: SandboxSession["spawn"],
  edits: Edits,
  path = filePath,
  abortSignal?: AbortSignal,
) {
  return editTool.execute!(
    { path, edits },
    {
      toolCallId: "test-edit",
      messages: [],
      context: {},
      // Model separate workflow workers reconnecting to the same remote filesystem.
      experimental_sandbox: { spawn: run } as SandboxSession,
      abortSignal,
    },
  );
}

function setup(initialContent: string | null, path = filePath, readDelayMs = 0) {
  const resolvedPath = path.startsWith("/") ? path : "/workspace/app/" + path.replace(/^\.\//u, "");
  const localPath = resolvedPath.replaceAll("/workspace/app", join(root, "app"));
  mkdirSync(dirname(localPath), { recursive: true });
  if (initialContent !== null) writeFileSync(localPath, initialContent);
  let notifyRead: () => void;
  const readStarted = new Promise<void>((resolve) => {
    notifyRead = resolve;
  });
  const run = vi.fn(async ({ command }: Parameters<SandboxSession["spawn"]>[0]) => {
    let localCommand = command.replaceAll("/workspace/app", join(root, "app"));
    if (readDelayMs) {
      // Force overlapping requests to read before either writes if locking regresses.
      localCommand = localCommand.replace(
        'const file = readFileSync(path, "utf8");',
        `const file = readFileSync(path, "utf8"); process.stdout.write("read\\n"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${readDelayMs});`,
      );
    }
    const child = nativeSpawn("/bin/bash", ["-c", localCommand], {
      env: { ...process.env, PATH: commands + ":" + process.env.PATH },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("read\n")) notifyRead();
    });
    const wait = new Promise<{ exitCode: number }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1 }));
    });
    return {
      stdout: Readable.toWeb(child.stdout),
      stderr: Readable.toWeb(child.stderr),
      wait: () => wait,
      kill: vi.fn(async () => {
        child.kill();
      }),
    };
  });

  return {
    execute: (edits: Edits, abortSignal?: AbortSignal, requestedPath = path) =>
      execute(run, edits, requestedPath, abortSignal),
    run,
    readStarted,
    stopReadDelay: () => {
      readDelayMs = 0;
    },
    localPath,
    getContent: () => (existsSync(localPath) ? readFileSync(localPath, "utf8") : null),
  };
}

describe("edit tool", () => {
  it.each(["src/app.txt", "./src/app.txt"])("resolves %s for editing", async (path) => {
    const harness = setup("before", path);
    await expect(harness.execute([{ oldText: "before", newText: "after" }])).resolves.toEqual({
      success: true,
      path: "/workspace/app/src/app.txt",
    });
    expect(harness.getContent()).toBe("after");
    expect(harness.run).toHaveBeenCalledOnce();
    expect(harness.run.mock.calls[0]?.[0].command).toContain("'/workspace/app/src/app.txt'");
  });

  it("applies edits in file order against the original content", async () => {
    const harness = setup("start\nmiddle\nend\n");
    const result = await harness.execute([
      { oldText: "end", newText: "done" },
      { oldText: "start", newText: "end" },
    ]);
    expect(result).toEqual({ success: true, path: filePath });
    expect(harness.getContent()).toBe("end\nmiddle\ndone\n");
    expect(harness.run).toHaveBeenCalledOnce();
  });

  it("matches metacharacters literally and writes replacement text literally", async () => {
    const harness = setup("axb\na.b\n");
    await harness.execute([{ oldText: "a.b", newText: "$&" }]);
    expect(harness.getContent()).toBe("axb\n$&\n");
  });

  it("replaces the original occurrence when an earlier edit creates a later oldText", async () => {
    const harness = setup("start\nmiddle\nend\n");
    await harness.execute([
      { oldText: "start", newText: "end" },
      { oldText: "end", newText: "done" },
    ]);
    expect(harness.getContent()).toBe("end\nmiddle\ndone\n");
  });

  it("quotes file paths and edit text without shell interpolation", async () => {
    const harness = setup("before", "odd' path\n.txt");
    await harness.execute([{ oldText: "before", newText: "'$(exit 3)`exit 4`\n" }]);
    expect(harness.getContent()).toBe("'$(exit 3)`exit 4`\n");
  });

  it.each([
    ["missing text", "alpha\nbeta\n", [{ oldText: "gamma", newText: "x" }], /Text not found/],
    ["duplicate text", "alpha\nalpha\n", [{ oldText: "alpha", newText: "x" }], /more than once/],
    [
      "overlapping edits",
      "abcdef",
      [
        { oldText: "abc", newText: "x" },
        { oldText: "bcd", newText: "y" },
      ],
      /overlaps/,
    ],
  ])(
    "rejects %s without changing the file, and permits the next edit",
    async (_name, initial, edits, message) => {
      const harness = setup(initial);
      await expect(harness.execute(edits)).rejects.toThrow(message);
      expect(harness.getContent()).toBe(initial);
      await harness.execute([{ oldText: initial, newText: "recovered" }]);
      expect(harness.getContent()).toBe("recovered");
    },
  );

  it("rejects a missing file without creating it", async () => {
    const harness = setup(null);
    await expect(harness.execute([{ oldText: "alpha", newText: "beta" }])).rejects.toThrow(
      "File not found",
    );
    expect(harness.getContent()).toBeNull();
  });

  it("forwards cancellation to the complete edit command", async () => {
    const controller = new AbortController();
    const harness = setup("before");
    await harness.execute([{ oldText: "before", newText: "after" }], controller.signal);
    expect(harness.run.mock.calls[0]?.[0].abortSignal).toBe(controller.signal);
  });

  it("rejects an already aborted edit without starting a command", async () => {
    const harness = setup("before");
    const controller = new AbortController();
    const reason = new Error("Cancelled");
    controller.abort(reason);
    await expect(
      harness.execute([{ oldText: "before", newText: "after" }], controller.signal),
    ).rejects.toBe(reason);
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.getContent()).toBe("before");
  });

  it("propagates cancellation of a running edit", async () => {
    let rejectWait: (reason: Error) => void;
    let notifyStarted: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const wait = new Promise<never>((_resolve, reject) => {
      rejectWait = reject;
    });
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    const kill = vi.fn(async () => {
      rejectWait(new Error("Killed"));
    });
    const run = vi.fn(async () => ({
      stdout: stream(),
      stderr: stream(),
      wait: () => {
        notifyStarted();
        return wait;
      },
      kill,
    }));
    const controller = new AbortController();
    const reason = new Error("Cancelled");
    const pending = execute(
      run,
      [{ oldText: "before", newText: "after" }],
      filePath,
      controller.signal,
    );
    await started;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(kill).toHaveBeenCalledOnce();
  });

  it.skipIf(!hasFlock)(
    "preserves concurrent edits from separate sessions, including a symlink alias (requires util-linux flock)",
    async () => {
      const harness = setup("alpha\nbeta\n", filePath, 100);
      const alias = join(root, "app", "alias.txt");
      symlinkSync(harness.localPath, alias);
      const originalMode = statSync(harness.localPath).mode;
      await Promise.all([
        harness.execute([{ oldText: "alpha", newText: "first" }]),
        harness.execute([{ oldText: "beta", newText: "second" }], undefined, "./alias.txt"),
      ]);
      expect(harness.getContent()).toBe("first\nsecond\n");
      expect(readFileSync(alias, "utf8")).toBe("first\nsecond\n");
      expect(statSync(harness.localPath).mode).toBe(originalMode);
    },
  );

  it.skipIf(!hasFlock)(
    "releases the file lock when an edit command is cancelled (requires util-linux flock)",
    async () => {
      const harness = setup("alpha\nbeta\n", filePath, 2_000);
      const controller = new AbortController();
      const reason = new Error("Cancelled");
      const pending = harness.execute([{ oldText: "alpha", newText: "first" }], controller.signal);
      // Cancel only after Node has acquired the lock and read the file.
      await harness.readStarted;
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(harness.getContent()).toBe("alpha\nbeta\n");
      harness.stopReadDelay();
      await harness.execute([{ oldText: "beta", newText: "second" }]);
      expect(harness.getContent()).toBe("alpha\nsecond\n");
    },
  );
});
