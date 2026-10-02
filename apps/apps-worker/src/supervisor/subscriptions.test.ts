import { Effect, Semaphore } from "effect";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import { expect, it, vi } from "vite-plus/test";
import { createSubscriptions } from "./subscriptions";
import type { SubscriptionConnection, SubscriptionSession } from "./subscriptions";
import { createSubscriptionHandler, subscriptionStream, deliverSubscription } from "../transport";
import type { Invocation } from "@tailorkit/app/protocol";
import type { Identity } from "@tailorkit/app/server";
import type { SubscriptionClient } from "@tailorkit/app/protocol";

function setup() {
  // Model durable records: reads copy data, rather than retaining live object references.
  const records = new Map<string, string>();
  const events = new EventTarget();
  const coordinator = Semaphore.makeUnsafe(1);
  const queue = {
    run: <A>(operation: () => Promise<A>) =>
      Effect.runPromise(
        coordinator.withPermits(1)(Effect.tryPromise({ try: operation, catch: (error) => error })),
      ),
  };
  const values = { public: 1, private: 2 };
  const query = vi.fn(async (input: Invocation, identity: Identity) => ({
    value: `${identity.userId}:${values[input.name as keyof typeof values]}`,
    tables: [input.name],
  }));
  function connection(user = "alice"): SubscriptionConnection {
    records.set(
      user,
      JSON.stringify({
        identity: { userId: user, expiresAt: Date.now() + 120_000 },
        subscriptions: [],
      }),
    );
    return {
      read: () => {
        const record = records.get(user);
        return record ? (JSON.parse(record) as SubscriptionSession) : undefined;
      },
      write: (session) => records.set(user, JSON.stringify(session)),
      send: (data) => events.dispatchEvent(new MessageEvent("message", { data })),
    };
  }
  const socket = connection();
  const sockets = [socket];
  const ctx = {
    getWebSockets: () =>
      sockets.map((socket) => ({
        deserializeAttachment: () => socket.read()!.identity.userId,
        send: (data: string | Uint8Array<ArrayBuffer>) => socket.send(data),
        close: vi.fn(),
      })),
    storage: {
      kv: {
        get: (key: string) => {
          const value = records.get(key.slice(7));
          return value ? JSON.parse(value) : undefined;
        },
        put: (key: string, value: unknown) => records.set(key.slice(7), JSON.stringify(value)),
        delete: (key: string) => records.delete(key.slice(7)),
      },
    },
  } as unknown as DurableObjectState;
  const create = () =>
    createSubscriptions(
      ctx,
      (input, identity) =>
        Effect.tryPromise({ try: () => query(input, identity), catch: (error) => error }),
      coordinator,
    );
  let subscriptions = create();
  let handler = createSubscriptionHandler();
  const subscribe = (input: Invocation) =>
    subscriptionStream((id) => subscriptions.subscribe(socket, input, id));
  const pending: Promise<void>[] = [];
  const client = createORPCClient<SubscriptionClient>(
    new RPCLink({
      connect: () => ({
        readyState: 1,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        send: (data: string | ArrayBuffer) => {
          pending.push(
            handler.message(socket, data, subscribe, (id) =>
              Effect.runPromise(subscriptions.cancel(socket, id)),
            ),
          );
        },
      }),
    }),
  );
  return {
    client,
    values,
    query,
    socket,
    records,
    sockets,
    connection,
    subscribe: (socket: SubscriptionConnection, input: Invocation) =>
      subscriptionStream((id) => subscriptions.subscribe(socket, input, id)),
    refresh: (tables: string[]) =>
      Effect.runPromise(coordinator.withPermits(1)(subscriptions.refresh(tables))),
    flush: async () => {
      await Promise.all(pending);
      await queue.run(async () => {});
    },
    recreate: () => {
      subscriptions = create();
      handler = createSubscriptionHandler();
    },
  };
}

it("restores multiple subscriptions and cancellation after recreation with isolated dependencies", async () => {
  const test = setup();
  const publicStream = await test.client.subscribe({ name: "public" });
  const privateStream = await test.client.subscribe({ name: "private" });
  expect(await publicStream.next()).toMatchObject({ value: "alice:1" });
  expect(await privateStream.next()).toMatchObject({ value: "alice:2" });
  await test.flush();
  expect(test.socket.read()!.subscriptions).toHaveLength(2);
  test.recreate();
  test.values.public = 3;
  test.query.mockClear();
  await test.refresh(["public"]);
  expect(await publicStream.next()).toMatchObject({ value: "alice:3" });
  expect(test.query).toHaveBeenCalledTimes(1);
  await publicStream.return?.();
  await test.flush();
  expect(test.socket.read()!.subscriptions).toHaveLength(1);
  test.recreate();
  test.values.private = 4;
  await test.refresh(["private"]);
  expect(await privateStream.next()).toMatchObject({ value: "alice:4" });
  await privateStream.return?.();
  await test.flush();
  expect(test.socket.read()!.subscriptions).toHaveLength(0);
});

it("delivers typed errors and removes failed subscriptions after recreation", async () => {
  const test = setup();
  const stream = await test.client.subscribe({ name: "public" });
  await stream.next();
  await test.flush();
  test.recreate();
  test.query.mockRejectedValueOnce({ code: "UNAUTHORIZED", message: "Expired" });
  await test.refresh(["public"]);
  await expect(stream.next()).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Expired" });
  expect(test.socket.read()!.subscriptions).toHaveLength(0);
});

it("does not register a snapshot after the connection disappears during its query", async () => {
  const test = setup();
  test.query.mockImplementationOnce(async () => {
    test.records.delete("alice");
    return { value: "gone", tables: ["public"] };
  });
  const stream = await test.client.subscribe({ name: "public" });
  await test.flush();
  expect(test.records.size).toBe(0);
  await stream.return?.();
  await test.flush();
});

it("does not fail mutation delivery when a disconnected socket throws", async () => {
  const test = setup();
  const stream = await test.client.subscribe({ name: "public" });
  await stream.next();
  await test.flush();
  test.socket.send = () => {
    throw new Error("Socket closed");
  };
  await expect(test.refresh(["public"])).resolves.toBeUndefined();
  expect(test.socket.read()!.subscriptions).toHaveLength(0);
  await stream.return?.();
  await test.flush();
});

it("registers the first snapshot before a concurrent mutation and replaces dependencies", async () => {
  const test = setup();
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let finish!: (snapshot: { value: string; tables: string[] }) => void;
  const initial = new Promise<{ value: string; tables: string[] }>((resolve) => {
    finish = resolve;
  });
  test.query.mockImplementationOnce(() => {
    ready();
    return initial;
  });
  test.query.mockResolvedValueOnce({ value: "alice:3", tables: ["private"] });
  const stream = await test.client.subscribe({ name: "public" });
  await started;
  const mutation = test.refresh(["public"]);
  finish({ value: "alice:0", tables: ["public"] });
  await mutation;
  expect(await stream.next()).toMatchObject({ value: "alice:0" });
  expect(await stream.next()).toMatchObject({ value: "alice:3" });
  await test.refresh(["public"]);
  expect(test.query).toHaveBeenCalledTimes(2);
  await test.refresh(["private"]);
  expect(test.query).toHaveBeenCalledTimes(3);
  await stream.return?.();
  await test.flush();
});

it("reruns as each stored identity and isolates failures on different connections", async () => {
  const test = setup();
  const stream = await test.client.subscribe({ name: "public" });
  await stream.next();
  const bob = test.connection("bob");
  test.sockets.push(bob);
  await test.subscribe(bob, { name: "public" })["~callback"]!("bob-subscription");
  await test.flush();
  test.recreate();
  test.query.mockClear();
  test.query.mockRejectedValueOnce({ code: "FORBIDDEN", message: "Denied" });
  await test.refresh(["public"]);
  await expect(stream.next()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(test.query.mock.calls.map((call) => call[1].userId)).toEqual(["alice", "bob"]);
  expect(test.socket.read()!.subscriptions).toHaveLength(0);
  expect(bob.read()!.subscriptions).toHaveLength(1);
});

it("reports an initial query error through the stream and removes its persisted registration", async () => {
  const test = setup();
  test.query.mockRejectedValueOnce({ code: "NOT_FOUND", message: "Missing query" });
  const stream = await test.client.subscribe({ name: "public" });
  await expect(stream.next()).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: "Missing query",
  });
  await test.flush();
  expect(test.socket.read()!.subscriptions).toHaveLength(0);
});

it("enforces the installation subscription limit using persisted state", async () => {
  const test = setup();
  const session = test.socket.read()!;
  session.subscriptions = Array.from({ length: 256 }, (_, index) => ({
    id: String(index),
    input: { name: "public" },
    tables: ["public"],
  }));
  test.socket.write(session);
  test.recreate();
  const stream = await test.client.subscribe({ name: "public" });
  await expect(stream.next()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await test.flush();
  expect(test.socket.read()!.subscriptions).toHaveLength(256);
  expect(test.query).not.toHaveBeenCalled();
});
