import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Identity } from "@tailorkit/app/server";
import type { SubscriptionSession } from "./subscriptions";
import { createSubscriptions } from "./subscriptions";
import { Effect, Semaphore } from "effect";

function setup() {
  const now = Date.now();
  const records = new Map<string, SubscriptionSession>();
  let alarm: number | null = null;
  const sockets: WebSocket[] = [];
  const operations = vi.fn();
  const cancel = vi.fn();
  const ctx = {
    getWebSockets: () => sockets,
    storage: {
      kv: {
        list: () => records.entries(),
        get: (key: string) => records.get(key),
        put: (key: string, value: SubscriptionSession) => records.set(key, value),
        delete: (key: string) => records.delete(key),
      },
      getAlarm: async () => alarm,
      setAlarm: async (time: number) => {
        alarm = time;
      },
      deleteAlarm: async () => {
        alarm = null;
      },
    },
  } as unknown as DurableObjectState;
  vi.stubGlobal("WebSocket", { CLOSED: 3 });
  function socket(id: string, expiresAt: number) {
    const socket = {
      deserializeAttachment: () => id,
      readyState: 2,
      close: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket;
    records.set(`socket:${id}`, { identity: { expiresAt } as Identity, subscriptions: [] });
    sockets.push(socket);
    return socket;
  }
  return {
    now,
    records,
    operations,
    cancel,
    socket,
    ctx,
    getAlarm: () => alarm,
    create: () =>
      createSubscriptions(
        ctx,
        (input, identity) => Effect.promise(() => operations(input, identity)),
        Semaphore.makeUnsafe(1),
      ),
  };
}

afterEach(() => vi.unstubAllGlobals());

it("rejects expired frames before decoding or executing a procedure", async () => {
  const test = setup();
  const socket = test.socket("expired", test.now - 1);
  await test.create().message(socket, "{}");
  expect(socket.close).toHaveBeenCalledWith(1008, "Authentication expired");
  expect(test.operations).not.toHaveBeenCalled();
  expect(test.records.size).toBe(0);
});

it("expires idle connections after recreation and schedules the next durable alarm", async () => {
  const test = setup();
  const expired = test.socket("expired", test.now - 1);
  const active = test.socket("active", test.now + 60_000);
  await test.create().alarm();
  expect(expired.close).toHaveBeenCalledWith(1008, "Authentication expired");
  expect(active.close).not.toHaveBeenCalled();
  expect(test.getAlarm()).toBe(test.now + 60_000);
  expect(test.create().connections()).toHaveLength(1);
  await test.create().close(active, 1000, "Renew authentication");
  expect(active.close).toHaveBeenCalledWith(1000, "Renew authentication");
  expect(test.records.size).toBe(0);
  expect(test.getAlarm()).toBeNull();
});

it("rejects delivery for expired sessions and cannot recreate closed records", () => {
  const test = setup();
  test.socket("expired", test.now - 1);
  const connection = test.create().connections()[0]!;
  expect(() => connection.send("snapshot")).toThrow("App token expired");
  const session = connection.read()!;
  test.records.clear();
  connection.write(session);
  expect(test.records.size).toBe(0);
});

it("removes abandoned durable records when an alarm wakes an installation with no sockets", async () => {
  const test = setup();
  test.records.set("socket:orphan", {
    identity: { expiresAt: test.now - 1 } as Identity,
    subscriptions: [],
  });
  await test.create().alarm();
  expect(test.records.size).toBe(0);
  expect(test.getAlarm()).toBeNull();
});
