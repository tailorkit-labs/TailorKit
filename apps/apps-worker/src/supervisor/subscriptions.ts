import { Effect } from "effect";
import type { Semaphore } from "effect";
import type { Identity } from "@tailorkit/app/server";
import { subscriptionStream, deliverSubscription, createSubscriptionHandler } from "../transport";
import { AppError } from "@tailorkit/app/server";
import type { Invocation } from "@tailorkit/app/protocol";

export interface SubscriptionSession {
  identity: Identity;
  subscriptions: { id: string; input: Invocation; tables: string[] }[];
}
export interface SubscriptionConnection {
  read(): SubscriptionSession | undefined;
  write(session: SubscriptionSession): void;
  send(data: string | Uint8Array<ArrayBuffer>): unknown;
}

/** Dependency tracking is independent of socket encoding and provider storage. */
export function createSubscriptions(
  ctx: DurableObjectState,
  query: (
    input: Invocation,
    identity: Identity,
  ) => Effect.Effect<{ value: unknown; tables: string[] }, unknown>,
  queue: Semaphore.Semaphore,
) {
  const handler = createSubscriptionHandler();
  function key(socket: WebSocket) {
    return `socket:${socket.deserializeAttachment() as string}`;
  }
  function connection(socket: WebSocket): SubscriptionConnection {
    return {
      read: () => ctx.storage.kv.get<SubscriptionSession>(key(socket)),
      write: (session) => {
        if (ctx.storage.kv.get(key(socket))) {
          ctx.storage.kv.put(key(socket), session);
        }
      },
      send: (data) => {
        const session = ctx.storage.kv.get<SubscriptionSession>(key(socket));
        if (!session || session.identity.expiresAt <= Date.now()) {
          socket.close(1008, "Authentication expired");
          throw new AppError("UNAUTHORIZED", "App token expired");
        }
        socket.send(data);
      },
    };
  }
  function connections() {
    return ctx
      .getWebSockets()
      .map(connection)
      .filter((current) => current.read());
  }
  async function arm() {
    // Read after the await so concurrently accepted sockets are included.
    const current = await ctx.storage.getAlarm();
    const expiries = connections().flatMap((socket) => {
      const session = socket.read();
      return session ? [session.identity.expiresAt] : [];
    });
    if (!expiries.length) {
      await ctx.storage.deleteAlarm();
      return;
    }
    const next = Math.min(...expiries);
    if (current !== next) {
      await ctx.storage.setAlarm(next);
    }
  }
  function remove(connection: SubscriptionConnection, id: string) {
    return Effect.sync(() => {
      const session = connection.read();
      if (!session) {
        return;
      }
      session.subscriptions = session.subscriptions.filter(
        (subscription) => subscription.id !== id,
      );
      connection.write(session);
    });
  }
  function deliver(
    connection: SubscriptionConnection,
    id: string,
    execute = query,
  ): Effect.Effect<void, unknown> {
    return Effect.gen(function* deliverSnapshot() {
      const session = connection.read();
      const subscription = session?.subscriptions.find((entry) => entry.id === id);
      if (!session || !subscription) {
        return;
      }
      const snapshot = yield* execute(subscription.input, session.identity);
      const current = connection.read();
      const active = current?.subscriptions.find((entry) => entry.id === id);
      if (!current || !active) {
        return;
      }
      active.tables = snapshot.tables;
      connection.write(current);
      yield* deliverSubscription(connection, id, snapshot.value);
    }).pipe(
      Effect.catch((error) =>
        remove(connection, id).pipe(
          Effect.andThen(deliverSubscription(connection, id, error, true)),
        ),
      ),
      Effect.catch(() => Effect.void),
    );
  }
  function subscribe(connection: SubscriptionConnection, input: Invocation, id: string) {
    return queue.withPermits(1)(
      Effect.gen(function* subscribe() {
        const session = connection.read();
        if (!session) {
          return;
        }
        const count = connections().reduce(
          (total, current) => total + (current.read()?.subscriptions.length ?? 0),
          0,
        );
        if (count >= 256) {
          yield* deliverSubscription(
            connection,
            id,
            new AppError("BAD_REQUEST", "Installation subscription limit exceeded"),
            true,
          );
          return;
        }
        session.subscriptions.push({ id, input, tables: [] });
        connection.write(session);
        yield* deliver(connection, id);
      }),
    );
  }
  return {
    connections,
    async open(identity: Identity) {
      if (connections().length >= 128) {
        throw new AppError("BAD_REQUEST", "Installation connection limit exceeded");
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      ctx.acceptWebSocket(server);
      server.serializeAttachment(crypto.randomUUID());
      ctx.storage.kv.put(key(server), {
        identity,
        subscriptions: [],
      } satisfies SubscriptionSession);
      await arm();
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "sec-websocket-protocol": "tailorkit" },
      });
    },
    message(socket: WebSocket, message: string | ArrayBuffer) {
      const current = connection(socket);
      const session = current.read();
      if (!session || session.identity.expiresAt <= Date.now()) {
        ctx.storage.kv.delete(key(socket));
        socket.close(1008, "Authentication expired");
        return Promise.resolve();
      }
      return handler.message(
        socket,
        message,
        (input) => subscriptionStream((id) => subscribe(current, input, id)),
        (id) => Effect.runPromise(queue.withPermits(1)(remove(current, id))),
      );
    },
    async close(socket: WebSocket, code = 1000, reason = "") {
      ctx.storage.kv.delete(key(socket));
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.close(code, reason);
      }
      await handler.close(socket);
      await arm();
    },
    async alarm() {
      const sockets = ctx.getWebSockets();
      const active = new Set(sockets.map(key));
      for (const [stored] of ctx.storage.kv.list({ prefix: "socket:" })) {
        if (!active.has(stored)) {
          ctx.storage.kv.delete(stored);
        }
      }
      for (const socket of sockets) {
        const session = connection(socket).read();
        if (!session || session.identity.expiresAt <= Date.now()) {
          ctx.storage.kv.delete(key(socket));
          socket.close(1008, "Authentication expired");
        }
      }
      await arm();
    },
    subscribe,
    cancel: (connection: SubscriptionConnection, id: string) =>
      queue.withPermits(1)(remove(connection, id)),
    /** External mutations and local action notifications serialize subscriber refreshes. */
    refresh(tables: string[], execute = query) {
      return Effect.gen(function* refresh() {
        for (const connection of connections()) {
          for (const subscription of connection.read()?.subscriptions ?? []) {
            if (subscription.tables.some((table) => tables.includes(table))) {
              yield* deliver(connection, subscription.id, execute);
            }
          }
        }
      });
    },
  };
}
