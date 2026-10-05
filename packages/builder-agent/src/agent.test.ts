import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { appAgent } from "./agent";
import instructions from "./instructions.md?raw";

const mocks = vi.hoisted(() => ({
  configureAgent: vi.fn(),
  getOrCreate: vi.fn(),
  createSession: vi.fn(),
  run: vi.fn(),
  stream: vi.fn(),
}));

vi.mock("@ai-sdk/workflow", () => ({
  WorkflowAgent: class {
    constructor(options: unknown) {
      mocks.configureAgent(options);
    }
    stream = mocks.stream;
  },
}));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { getOrCreate: mocks.getOrCreate } }));
vi.mock("@ai-sdk/sandbox-vercel", () => ({
  createVercelNetworkSandboxSessionFromNativeSandbox: mocks.createSession,
}));
vi.mock("workflow", () => ({
  FatalError: class extends Error {},
  getWorkflowMetadata: () => ({ workflowName: "chat", workflowRunId: "test" }),
  getWritable: () => ({}),
}));

describe("agent skill instructions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrCreate.mockResolvedValue({ name: "test-sandbox" });
    mocks.createSession.mockReturnValue({ run: mocks.run });
    mocks.stream.mockResolvedValue({ messages: [] });
  });

  it("discovers sandbox skills and appends their catalog to the system prompt", async () => {
    const path = "/workspace/app/.agents/skills/tailorkit-apps/SKILL.md";
    mocks.run.mockResolvedValue({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        type: "match",
        data: {
          path: { text: path },
          lines: { text: "---\nname: tailorkit-apps\ndescription: Build TailorKit apps\n---\n" },
        },
      }),
    });

    await appAgent({ messages: [], model: "test-model" as LanguageModel });

    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.configureAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining(instructions.trim()),
      }),
    );
    const prompt: string = mocks.configureAgent.mock.calls[0]?.[0].instructions;
    expect(prompt).toContain("## Available skills");
    expect(prompt).toContain('"name": "tailorkit-apps"');
    expect(prompt).toContain('"description": "Build TailorKit apps"');
    expect(prompt).toContain(path);
    expect(mocks.stream).toHaveBeenCalledOnce();
  });

  it("runs with base instructions when the sandbox has no skills", async () => {
    mocks.run.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    await appAgent({ messages: [], model: "test-model" as LanguageModel });

    expect(mocks.configureAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: `${instructions.trim()}\n\n## Available skills\n\nNo skills are available in this sandbox.`,
      }),
    );
    expect(mocks.stream).toHaveBeenCalledOnce();
  });
});
