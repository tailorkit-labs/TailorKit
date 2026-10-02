import { afterEach, expect, it, vi } from "vite-plus/test";

import { createActionLeases, actionDestination } from "./actions";
import { abortable } from "../runtime/cancellation";
vi.mock("cloudflare:workers", () => ({ RpcTarget: function RpcTarget() {} }));

const identity = {
  userId: "user",
  projectId: "project",
  appId: "app",
  installationId: "install",
  deploymentId: "v1",
  expiresAt: Date.now() + 60_000,
};

afterEach(() => vi.useRealTimers());

it("admits actions without an application concurrency limit and revokes them on close", () => {
  const leases = createActionLeases();
  const active = Array.from({ length: 32 }, () => leases.open(identity));
  expect(active.every((lease) => !lease.signal.aborted)).toBe(true);
  for (const lease of active) {
    lease.close();
    expect(lease.signal.aborted).toBe(true);
  }
});

it("expires actions on cancellation or token expiry", async () => {
  vi.useFakeTimers();
  const leases = createActionLeases();
  const parent = new AbortController();
  const cancelled = leases.open(identity, parent.signal);
  const waiting = abortable(new Promise(() => {}), cancelled.signal);
  const assertion = expect(waiting).rejects.toBeDefined();
  parent.abort();
  await assertion;
  expect(cancelled.signal.aborted).toBe(true);
  cancelled.close();
  const expiry = leases.open(identity);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(expiry.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(expiry.signal.aborted).toBe(true);
  expiry.close();
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

it("cancels all active actions on deployment replacement", () => {
  const leases = createActionLeases();
  const first = leases.open(identity);
  const second = leases.open(identity);
  leases.closeAll();
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(true);
  first.close();
  second.close();
  const next = leases.open(identity);
  expect(next.signal.aborted).toBe(false);
  next.close();
});
