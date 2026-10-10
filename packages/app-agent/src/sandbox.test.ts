import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { APIError } from "@vercel/sandbox";
import { FatalError } from "workflow";
import {
  deleteSandbox,
  getSandbox,
  prepareSandbox,
  sandboxIdleTimeoutMs,
  writeAgentSchema,
  agentSchemaPath,
} from "./sandbox";

const mocks = vi.hoisted(() => ({
  drive: vi.fn(),
  get: vi.fn(),
  getOrCreate: vi.fn(),
  delete: vi.fn(),
  extend: vi.fn(),
  writeFiles: vi.fn(),
}));
vi.mock("workflow", () => ({ FatalError: class extends Error {} }));
vi.mock("@vercel/sandbox", () => ({
  APIError: class extends Error {
    response: Response;
    constructor(response: Response, options?: { message: string }) {
      super(options?.message);
      this.response = response;
    }
  },
  Drive: { getOrCreate: mocks.drive },
  Sandbox: { get: mocks.get, getOrCreate: mocks.getOrCreate },
}));

const sandboxName = "app-agent-bob";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(300_000);
  mocks.drive.mockResolvedValue({ name: "app-123", region: "syd1" });
  mocks.getOrCreate.mockResolvedValue({ name: sandboxName });
  mocks.get.mockResolvedValue({
    name: sandboxName,
    status: "running",
    expiresAt: new Date(sandboxIdleTimeoutMs),
    currentSession: () => ({ extendTimeout: mocks.extend, writeFiles: mocks.writeFiles }),
    delete: mocks.delete,
  });
});

describe("sandbox ownership and sliding timeout", () => {
  it("mounts the persistent Drive on a disposable 15-minute sandbox without stopping it", async () => {
    await prepareSandbox("app-123", sandboxName);
    expect(mocks.getOrCreate).toHaveBeenCalledWith({
      name: sandboxName,
      image: "vercel/sandbox/universal",
      region: "syd1",
      persistent: false,
      timeout: sandboxIdleTimeoutMs,
      mounts: { "/workspace": expect.objectContaining({ name: "app-123" }) },
    });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("writes a supplied schema as JSON on the persistent Drive", async () => {
    const schema = { version: 1, components: {}, views: {}, slots: {}, tools: {} };
    await writeAgentSchema(sandboxName, schema);
    expect(mocks.writeFiles).toHaveBeenCalledExactlyOnceWith([
      { path: agentSchemaPath, content: Buffer.from(JSON.stringify(schema), "utf-8") },
    ]);
    expect(agentSchemaPath).toBe("/workspace/tailorkit.schema.json");
  });

  it("fails busy Drive requests immediately without touching the active writer", async () => {
    mocks.drive.mockResolvedValue({ name: "app-123", currentSandboxName: "app-agent-alice" });
    const preparation = prepareSandbox("app-123", sandboxName);
    await expect(preparation).rejects.toBeInstanceOf(FatalError);
    await expect(preparation).rejects.toThrow("already being edited");
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });

  it("makes a racing mount rejection fatal instead of waiting through step retries", async () => {
    mocks.getOrCreate.mockRejectedValue(
      new APIError(new Response(null, { status: 409 }), {
        message: "Drive is already mounted",
      }),
    );
    await expect(prepareSandbox("app-123", sandboxName)).rejects.toBeInstanceOf(FatalError);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("extends only the missing five minutes when ten minutes remain", async () => {
    await getSandbox(sandboxName);
    expect(mocks.get).toHaveBeenCalledWith({ name: sandboxName });
    expect(mocks.extend).toHaveBeenCalledWith(300_000);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("does not accumulate another fifteen minutes when it already has fifteen remaining", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    await getSandbox(sandboxName);
    expect(mocks.extend).not.toHaveBeenCalled();
  });

  it("rejects expired or stopped VMs without resuming or recreating them", async () => {
    mocks.get.mockResolvedValueOnce({ status: "running", expiresAt: new Date(299_999) });
    await expect(getSandbox(sandboxName)).rejects.toThrow("no longer running");
    mocks.get.mockResolvedValueOnce({ status: "stopped" });
    await expect(getSandbox(sandboxName)).rejects.toThrow("no longer running");
    expect(mocks.extend).not.toHaveBeenCalled();
    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });

  it("deletes only the supplied sandbox and tolerates already-deleted metadata", async () => {
    await deleteSandbox(sandboxName);
    expect(mocks.get).toHaveBeenCalledWith({ name: sandboxName });
    expect(mocks.delete).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
    mocks.get.mockRejectedValue(new APIError(new Response(null, { status: 404 })));
    await expect(deleteSandbox(sandboxName)).resolves.toBeUndefined();
  });
});
