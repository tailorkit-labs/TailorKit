import { expect, it, vi } from "vite-plus/test";
import { createIframeBackend } from "./backend";

it("correlates scoped JWT requests, forwards renewal and ignores unsolicited responses", async () => {
  const send = vi.fn();
  const bridge = createIframeBackend(send);
  const initial = bridge.getSession({ refresh: false });
  const refresh = bridge.getSession({ refresh: true });
  expect(send.mock.calls.map(([request]) => request.refresh)).toEqual([false, true]);
  const session = {
    token: "token",
    url: "https://runtime.test/rpc",
    expiresAt: Date.now() + 120_000,
  };
  bridge.receive({ id: "unsolicited", session });
  bridge.receive({ id: send.mock.calls[1]?.[0].id ?? "missing", session });
  await expect(refresh).resolves.toEqual(session);
  bridge.receive({
    id: send.mock.calls[0]?.[0].id ?? "missing",
    error: { code: "FORBIDDEN", message: "Denied" },
  });
  await expect(initial).rejects.toMatchObject({ code: "FORBIDDEN", message: "Denied" });
  bridge.close();
});
it("rejects pending JWT requests and further calls when the sandbox is destroyed", async () => {
  const bridge = createIframeBackend(() => {});
  const pending = bridge.getSession({ refresh: false });
  bridge.close();
  await expect(pending).rejects.toThrow("Sandbox was destroyed");
  await expect(bridge.getSession({ refresh: false })).rejects.toThrow("Sandbox was destroyed");
});

it("preserves transient session errors for mutation retry", async () => {
  const send = vi.fn();
  const bridge = createIframeBackend(send);
  const session = bridge.getSession({ refresh: false });
  bridge.receive({
    id: send.mock.calls[0]![0].id,
    error: { code: "UNAVAILABLE", message: "Try again" },
  });
  await expect(session).rejects.toMatchObject({ code: "UNAVAILABLE" });
  bridge.close();
});
