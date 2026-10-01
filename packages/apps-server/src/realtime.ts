import type { Identity } from "./functions";
import type { ExecutionResult, MutationResult, Invocation } from "./execution";
import { AppError } from "./errors";

/** Persistence/execution and delivery are deliberately independent. */
export interface Execution {
  query(input: Invocation, identity: Identity): Promise<ExecutionResult>;
  mutate(input: Invocation & { requestId: string }, identity: Identity): Promise<MutationResult>;
}
interface Subscription {
  input: Invocation;
  identity: Identity;
  tables: string[];
  next(value: unknown): void;
  fail(error: unknown): void;
}

export function createRealtime(execution: Execution) {
  const subscriptions = new Set<Subscription>();
  let pending: Promise<unknown> = Promise.resolve();
  function queue<T>(run: () => Promise<T>) {
    const result = pending.then(run);
    pending = result.catch(() => {});
    return result;
  }
  return {
    query(input: Invocation, identity: Identity) {
      return queue(async () => (await execution.query(input, identity)).value);
    },
    mutate(input: Invocation & { requestId: string }, identity: Identity) {
      return queue(async () => {
        const result = await execution.mutate(input, identity);
        if (result.committed && result.tables.length) {
          // Queue reruns before accepting another operation; no initial-snapshot registration gap.
          for (const subscription of subscriptions)
            if (subscription.tables.some((table) => result.tables.includes(table))) {
              try {
                const rerun = await execution.query(subscription.input, subscription.identity);
                if (subscriptions.has(subscription)) {
                  subscription.tables = rerun.tables;
                  subscription.next(rerun.value);
                }
              } catch (error) {
                subscriptions.delete(subscription);
                subscription.fail(error);
              }
            }
        }
        return result.value;
      });
    },
    subscribe(
      input: Invocation,
      identity: Identity,
      next: (value: unknown) => void,
      fail: (error: unknown) => void,
    ) {
      if (subscriptions.size >= 256)
        throw new AppError("BAD_REQUEST", "Installation subscription limit exceeded");
      const subscription: Subscription = { input, identity, tables: [], next, fail };
      subscriptions.add(subscription);
      void queue(async () => {
        if (!subscriptions.has(subscription)) return;
        try {
          const initial = await execution.query(input, identity);
          if (subscriptions.has(subscription)) {
            subscription.tables = initial.tables;
            next(initial.value);
          }
        } catch (error) {
          subscriptions.delete(subscription);
          fail(error);
        }
      });
      return () => {
        subscriptions.delete(subscription);
      };
    },
  };
}
