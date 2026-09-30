/** Persistent storage only. Notification delivery has its own interface. */
export interface SqlDriver {
  execute(sql: string, bindings?: unknown[]): Record<string, unknown>[];
  transaction<T>(run: () => T): T;
}
export interface Migration {
  readonly id: string;
  readonly hash: string;
  readonly statements: readonly string[];
}
export interface Invalidation {
  readonly revision: number;
  readonly tables: readonly string[];
}
/** Delivery adapters must register synchronously and deliver in commit order. */
export interface Notifications {
  publish(change: Invalidation): void;
  listen(listener: (change: Invalidation) => void): () => void;
}
export function localNotifications(): Notifications {
  const listeners = new Set<(change: Invalidation) => void>();
  return {
    publish(change) {
      for (const listener of listeners) {
        listener(change);
      }
    },
    listen(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
