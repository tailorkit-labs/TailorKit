/* oxlint-disable react/immutability -- Preact refs are mutable; the React compiler rule does not recognize preact/hooks.useRef. */
import { createStore } from "@tanstack/store";
import { createContext, h } from "preact";
import type { ComponentChildren } from "preact";
import { useSyncExternalStore } from "preact/compat";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { createClient } from "./client/connection";
import type { Client } from "./client/connection";
import { reference } from "./client/reference";
import type { Reference } from "./client/reference";
import { pendingQuery, QueryStore, serializeInput } from "./client/query-store";
import type { QueryState } from "./client/query-store";
import { appError } from "./errors";
import type { AppError } from "./errors";

const Context = createContext<QueryStore | null>(null);

export interface ClientProviderProps {
  children?: ComponentChildren;
  /** Supply a client for custom transport configuration. Caller-owned clients are not closed. */
  client?: Client;
  onError?: (error: AppError) => void;
}

export function ClientProvider({ children, client, onError }: ClientProviderProps) {
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const store = useMemo(
    () =>
      new QueryStore(client ?? createClient(), !client, (error) => errorHandler.current?.(error)),
    [client],
  );
  useLayoutEffect(() => () => store.dispose(), [store]);
  return h(Context.Provider, { value: store }, children);
}

function useStore() {
  const store = useContext(Context);
  if (!store) {
    throw new Error("TailorKit backend hooks require a ClientProvider at the app root.");
  }
  return store;
}

export interface QueryOptions {
  enabled?: boolean;
}

type InputArguments<I> = undefined extends I ? [input?: I] : [input: I];
type QueryArguments<I> = undefined extends I
  ? [input?: I, options?: QueryOptions]
  : [input: I, options?: QueryOptions];

export interface QueryResult<T> extends QueryState<T> {
  isPending: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
}

export function useQuery<I, O>(
  ref: Reference<"query", I, O>,
  ...[input, options]: QueryArguments<NoInfer<I>>
): QueryResult<O> {
  const store = useStore();
  const enabled = options?.enabled ?? true;
  const name = ref.name;
  const serialized = serializeInput(input);
  const key = `${name}\0${serialized}`;
  const stableInput = useMemo(() => (JSON.parse(serialized) as { input: I }).input, [serialized]);
  const stableReference = useMemo(() => reference<"query", I, O>(name, "query"), [name]);
  const subscribe = useCallback(
    (onChange: () => void) => store.state.subscribe(onChange).unsubscribe,
    [store],
  );
  const getSnapshot = useCallback(
    () => (enabled ? (store.state.get().get(key) ?? pendingQuery) : pendingQuery) as QueryState<O>,
    [store, key, enabled],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (enabled) {
      return store.watch(key, stableReference, stableInput);
    }
  }, [store, key, enabled, stableInput, stableReference]);
  return {
    ...state,
    isPending: state.status === "pending",
    isLoading: enabled && state.status === "pending",
    isSuccess: state.status === "success",
    isError: state.status === "error",
  };
}

export interface CallOptions<I, O> {
  onSuccess?: (data: O, input: I) => void;
  onError?: (error: AppError, input: I) => void;
}

export interface CallState<T> {
  data: T | undefined;
  error: AppError | null;
  status: "idle" | "pending" | "success" | "error";
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  reset: () => void;
}

const idleCall = { data: undefined, error: null, status: "idle" as const };

function useCall<K extends "mutation" | "action", I, O>(
  kind: K,
  ref: Reference<K, I, O>,
  options: CallOptions<I, O>,
) {
  const store = useStore();
  const name = ref.name;
  const identity = useMemo(
    () => ({
      store,
      name,
      kind,
      state: createStore<Pick<CallState<O>, "data" | "error" | "status">>(idleCall),
    }),
    [store, name, kind],
  );
  const subscribe = useCallback(
    (onChange: () => void) => identity.state.subscribe(onChange).unsubscribe,
    [identity],
  );
  const state = useSyncExternalStore(subscribe, identity.state.get, identity.state.get);
  const current = useRef({ identity, sequence: 0, mounted: true });
  if (current.current.identity !== identity) {
    current.current = { identity, sequence: current.current.sequence + 1, mounted: true };
  }
  const callbacks = useRef(options);
  callbacks.current = options;
  useLayoutEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
      current.current.sequence += 1;
    };
  }, []);
  const runAsync = useCallback(
    async (...[input]: InputArguments<I>): Promise<O> => {
      const sequence = ++current.current.sequence;
      const settings = callbacks.current;
      const args = input as I;
      const isCurrent = () =>
        current.current.mounted &&
        current.current.identity === identity &&
        current.current.sequence === sequence;
      identity.state.setState(() => ({ ...idleCall, status: "pending" }));
      let data: O;
      try {
        data =
          kind === "mutation"
            ? await store.client.mutate(reference<"mutation", I, O>(name, "mutation"), args)
            : await store.client.action(reference<"action", I, O>(name, "action"), args);
      } catch (error) {
        const failure = appError(error);
        if (isCurrent()) {
          identity.state.setState(() => ({ data: undefined, error: failure, status: "error" }));
          settings.onError?.(failure, args);
        }
        store.onError(failure);
        throw failure;
      }
      if (isCurrent()) {
        identity.state.setState(() => ({ data, error: null, status: "success" }));
        settings.onSuccess?.(data, args);
      }
      return data;
    },
    [identity, kind, store, name],
  );
  const run = useCallback(
    (...args: InputArguments<I>) => {
      void runAsync(...args).catch(() => {});
    },
    [runAsync],
  );
  const reset = useCallback(() => {
    current.current.sequence += 1;
    identity.state.setState(() => idleCall);
  }, [identity]);
  return {
    ...state,
    isPending: state.status === "pending",
    isSuccess: state.status === "success",
    isError: state.status === "error",
    reset,
    run,
    runAsync,
  };
}

export interface MutationResult<I, O> extends CallState<O> {
  mutate: (...args: InputArguments<I>) => void;
  mutateAsync: (...args: InputArguments<I>) => Promise<O>;
}

export function useMutation<I, O>(
  ref: Reference<"mutation", I, O>,
  options: CallOptions<I, O> = {},
): MutationResult<I, O> {
  const { run, runAsync, ...state } = useCall("mutation", ref, options);
  return { ...state, mutate: run, mutateAsync: runAsync };
}

export interface ActionResult<I, O> extends CallState<O> {
  execute: (...args: InputArguments<I>) => void;
  executeAsync: (...args: InputArguments<I>) => Promise<O>;
}

export function useAction<I, O>(
  ref: Reference<"action", I, O>,
  options: CallOptions<I, O> = {},
): ActionResult<I, O> {
  const { run, runAsync, ...state } = useCall("action", ref, options);
  return { ...state, execute: run, executeAsync: runAsync };
}
