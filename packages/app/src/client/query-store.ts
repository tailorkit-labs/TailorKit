import { atom } from "nanostores";
import type { Client } from "./connection";
import type { Reference } from "./reference";
import type { AppError } from "../errors";
import { appError } from "../errors";

export interface QueryState<T> {
  data: T | undefined;
  error: AppError | null;
  status: "pending" | "success" | "error";
}

export const pendingQuery: QueryState<never> = { data: undefined, error: null, status: "pending" };

export function serializeInput(input: unknown): string {
  return JSON.stringify({ input, defined: input !== undefined }, (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
}

interface Entry {
  observers: number;
  stop?: () => void;
}

/** One subscription per active query/input pair, scoped to this provider's client. */
export class QueryStore {
  readonly state = atom(new Map<string, QueryState<unknown>>());
  private readonly entries = new Map<string, Entry>();
  private disposed = false;
  readonly client: Client;
  private readonly ownsClient: boolean;
  private readonly errorHandler: (error: AppError) => void;

  constructor(
    client: Client,
    ownsClient: boolean,
    errorHandler: (error: AppError) => void = () => {},
  ) {
    this.client = client;
    this.ownsClient = ownsClient;
    this.errorHandler = errorHandler;
  }

  watch<I, O>(key: string, ref: Reference<"query", I, O>, input: I) {
    let entry = this.entries.get(key);
    const first = !entry;
    if (!entry) {
      entry = { observers: 0 };
      this.entries.set(key, entry);
    }
    const current = entry;
    current.observers += 1;
    const publish = (state: QueryState<O>) => {
      if (!this.disposed && this.entries.get(key) === current) {
        this.state.set(new Map(this.state.get()).set(key, state));
      }
    };
    if (first) {
      const onError = (error: AppError) => {
        if (this.disposed || this.entries.get(key) !== current) {
          return;
        }
        publish({ data: this.state.get().get(key)?.data as O | undefined, error, status: "error" });
        this.onError(error);
      };
      try {
        current.stop = this.client.subscribe(
          ref,
          input,
          (data) => publish({ data, error: null, status: "success" }),
          { onError },
        );
      } catch (error) {
        onError(appError(error));
      }
    }
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      current.observers -= 1;
      if (current.observers === 0 && this.entries.get(key) === current) {
        this.entries.delete(key);
        current.stop?.();
        const next = new Map(this.state.get());
        next.delete(key);
        this.state.set(next);
      }
    };
  }

  dispose() {
    this.disposed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      entry.stop?.();
      entry.stop = undefined;
    }
    this.state.set(new Map());
    if (this.ownsClient) {
      this.client.close();
    }
  }

  onError(error: AppError) {
    if (!this.disposed) {
      this.errorHandler(error);
    }
  }
}
