import { expect, it, vi } from "vite-plus/test";
import { createRpcConnection } from "./transport";
import { createRealtime } from "./realtime";

it("rejects oversized and expired frames before RPC dispatch", async () => {
  for (const expired of [false, true]) {
    const target = new EventTarget();
    const close = vi.fn();
    const query = vi.fn();
    const realtime = createRealtime({ query, mutate: vi.fn() });
    const connection = createRpcConnection(
      realtime,
      {
        send: vi.fn(),
        close,
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
      },
      {
        userId: "user",
        projectId: "project",
        appId: "app",
        installationId: "install",
        deploymentId: "deployment",
        expiresAt: Date.now() + (expired ? -1000 : 60_000),
      },
    );
    target.dispatchEvent(
      new MessageEvent("message", { data: expired ? "{}" : "a".repeat(1024 * 1024 + 1) }),
    );
    expect(close).toHaveBeenCalledWith(
      expired ? 1008 : 1009,
      expired ? "Authentication expired" : "Request too large",
    );
    expect(query).not.toHaveBeenCalled();
    await connection.close();
  }
});
