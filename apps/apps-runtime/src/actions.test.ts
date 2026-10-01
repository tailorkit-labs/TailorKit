import { afterEach, expect, it, vi } from "vite-plus/test";
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
import { ActionLeases, actionDestination, abortable } from "./actions";
const identity = {
  userId: "user",
  projectId: "project",
  appId: "app",
  installationId: "install",
  deploymentId: "v1",
  expiresAt: Date.now() + 60_000,
};
afterEach(() => vi.useRealTimers());
it("binds, limits and revokes action capabilities", () => {
  const leases = new ActionLeases();
  const lease = leases.open(identity);
  expect(leases.access(lease.id).identity).toEqual(identity);
  expect(() => leases.access("forged")).toThrow("Action has ended");
  for (let call = 1; call < 64; call++) leases.access(lease.id);
  expect(() => leases.access(lease.id)).toThrow("call limit");
  lease.close();
  expect(() => leases.access(lease.id)).toThrow("Action has ended");
});
it("expires capabilities on cancellation, deadline or token expiry", async () => {
  vi.useFakeTimers();
  const leases = new ActionLeases();
  const parent = new AbortController();
  const cancelled = leases.open(identity, parent.signal);
  const waiting = abortable(new Promise(() => {}), cancelled.signal);
  const assertion = expect(waiting).rejects.toThrow("Action cancelled");
  parent.abort();
  await assertion;
  expect(() => leases.access(cancelled.id)).toThrow("Action has ended");
  cancelled.close();
  const deadline = leases.open(identity);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(() => leases.access(deadline.id)).toThrow("Action has ended");
  deadline.close();
  expect(() => leases.open({ ...identity, expiresAt: Date.now() })).toThrow("token expired");
});
it.each([
  "http://example.com",
  "https://localhost",
  "https://127.0.0.1",
  "https://2130706433",
  "https://10.0.0.1",
  "https://172.16.0.1",
  "https://192.168.1.1",
  "https://169.254.169.254",
  "https://[::1]",
  "https://[::ffff:127.0.0.1]",
  "https://host.internal",
  "https://user:password@example.com",
])("blocks action egress to %s", (url) => {
  expect(() => actionDestination(new URL(url))).toThrow("public HTTPS");
});
it("allows HTTPS Internet destinations", () => {
  expect(() => actionDestination(new URL("https://api.example.com/path"))).not.toThrow();
});
