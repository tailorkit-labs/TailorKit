import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  client: vi.fn(),
  close: vi.fn(),
  load: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  token: vi.fn(),
  whoami: vi.fn(),
  heartbeat: vi.fn(),
}));

vi.mock("@tailorkit/app/config/loader", () => ({ loadTailorKitConfig: mocks.load }));
vi.mock("@tailorkit/app/builder", () => ({ buildApp: mocks.build }));
vi.mock("@tailorkit/core/server", () => ({ createTailorKitClient: mocks.client }));
vi.mock("@tailorkit/client-platform/preview", () => ({
  createPreviewWebSocketClient: () => ({ heartbeat: mocks.heartbeat }),
}));
vi.mock("./auth", () => ({ getDeployToken: mocks.token, runWhoami: mocks.whoami }));

const { runPreview } = await import("./preview");
const dirs: string[] = [];
let signalListeners: {
  SIGINT: ReturnType<typeof process.listeners>;
  SIGTERM: ReturnType<typeof process.listeners>;
};

beforeEach(() => {
  signalListeners = {
    SIGINT: process.listeners("SIGINT"),
    SIGTERM: process.listeners("SIGTERM"),
  };
  vi.resetAllMocks();
  mocks.build.mockResolvedValue({ close: mocks.close });
  mocks.close.mockImplementation(async () => {});
  mocks.client.mockReturnValue({ preview: { start: mocks.start, stop: mocks.stop } });
  mocks.start.mockResolvedValue({ data: { sessionId: "session" } });
  mocks.stop.mockImplementation(async () => {});
  mocks.token.mockResolvedValue({ deployToken: "token" });
  mocks.whoami.mockResolvedValue({ hostUrl: "https://host.test" });
  mocks.heartbeat.mockResolvedValue({ accepted: true });
});

it.each(["Preview session is unavailable.", "Preview CLI token is unavailable."])(
  "stops reconnecting when heartbeat reports %s",
  async (message) => {
    class PreviewSocket extends EventTarget {
      static instances: PreviewSocket[] = [];
      closed = false;
      constructor(_url: URL, _protocol: string) {
        super();
        PreviewSocket.instances.push(this);
      }
      close() {
        this.closed = true;
        this.dispatchEvent(new Event("close"));
      }
      open() {
        this.dispatchEvent(new Event("open"));
      }
    }
    vi.stubGlobal("WebSocket", PreviewSocket);
    const cwd = await mkdtemp(path.join(tmpdir(), "tailorkit-preview-terminal-"));
    dirs.push(cwd);
    await mkdir(path.join(cwd, "output"));
    await writeFile(path.join(cwd, "output/client.js"), "export default 1");
    mocks.load.mockResolvedValue({ root: cwd, config: { appId: "app" } });
    mocks.start.mockResolvedValue({
      data: {
        sessionId: "session",
        tunnelUrl: "wss://platform.test/preview",
        tunnelToken: "token",
        shareId: "share",
      },
    });
    mocks.heartbeat.mockRejectedValue({
      code: "UNAUTHORIZED",
      message,
    });

    await runPreview({ cwd, outDir: "output" });
    const socket = PreviewSocket.instances[0];
    socket?.open();
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(socket?.closed).toBe(true);
    expect(process.listeners("SIGINT")).toEqual(signalListeners.SIGINT);
    expect(process.listeners("SIGTERM")).toEqual(signalListeners.SIGTERM);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(PreviewSocket.instances).toHaveLength(1);
  },
);

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    for (const listener of process.listeners(signal)) {
      if (!signalListeners[signal].includes(listener)) {
        process.off(signal, listener);
      }
    }
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it.each([
  ["output resolution", false, /ENOENT/u],
  ["initial snapshot validation", true, /missing client\.js/u],
])("cleans up after %s fails", async (_case, createOutput, expected) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "tailorkit-preview-startup-"));
  dirs.push(cwd);
  if (createOutput) {
    await mkdir(path.join(cwd, "output"));
  }
  mocks.load.mockResolvedValue({ root: cwd, config: { appId: "app" } });

  await expect(runPreview({ cwd, outDir: "output" })).rejects.toThrow(expected);
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.stop).toHaveBeenCalledWith({ sessionId: "session" });
  const closeOrder = mocks.close.mock.invocationCallOrder[0] ?? Infinity;
  const stopOrder = mocks.stop.mock.invocationCallOrder[0] ?? -Infinity;
  expect(closeOrder).toBeLessThan(stopOrder);
});
