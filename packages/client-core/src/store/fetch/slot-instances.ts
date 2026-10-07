import type { ViewInstance } from "@tailorkit/app/client";
import type { ActiveView } from "@tailorkit/core/views";
import type { TailorKitFetchClient } from "../../client/fetch-client";
import { resolveSlotView } from "../../client/slot-view";
import type { TailorKitApp } from "../../types";
import type { FetchCacheOptions, FetchOptions, FetchSnapshot } from "./cache";

export interface SlotInstancesStoreOptions extends FetchCacheOptions {
  app: TailorKitApp;
  slot: string;
  activeView: ActiveView | null;
}

export interface SlotInstancesSnapshot {
  data: ViewInstance[] | undefined;
  error: Error | null;
  status: FetchSnapshot<unknown>["status"];
  isFetching: boolean;
}

interface Result {
  status: "ready" | "loading";
  data?: ViewInstance[];
}

/** Resolve host context before authorizing an app or sending an instance request. */
export function createSlotInstancesStore(
  client: TailorKitFetchClient,
  options: SlotInstancesStoreOptions,
) {
  const { app, slot, activeView, staleTime, gcTime } = options;
  const settings = {
    ...(staleTime === undefined ? {} : { staleTime }),
    ...(gcTime === undefined ? {} : { gcTime }),
  };
  const idle: SlotInstancesSnapshot = {
    data: undefined,
    error: null,
    status: "idle",
    isFetching: false,
  };
  const query = client.cache.getStore<Result>(
    [
      "tailorkit",
      client.baseUrl.toString(),
      "resolvedInstances",
      app.id,
      app.currentDeployment?.id,
      app.preview?.sessionId,
      app.views ?? [],
      slot,
      activeView,
    ],
    async (signal) => {
      if (
        !(app.views ?? []).some((view) => view.slot === slot && view.instances && !view.disabled)
      ) {
        return { status: "ready", data: [] };
      }
      const meta = client.meta();
      await meta.fetch();
      signal.throwIfAborted();
      const snapshot = meta.getSnapshot();
      if (snapshot.error) throw snapshot.error;
      if (!snapshot.data) throw new Error("TailorKit metadata is unavailable.");
      const resolved = resolveSlotView(app.views ?? [], slot, activeView!, snapshot.data.schema);
      if (!resolved?.instances) return { status: "ready", data: [] };
      if (resolved.status === "error")
        throw new Error(`Context for view "${resolved.view}" is unavailable.`);
      if (resolved.status !== "ready") return { status: "loading" };
      // This store is already cached and cancellation is owned by its last subscriber.
      const data = await client.endpoints.slotInstances(
        app,
        { slot, path: resolved.view, context: resolved.context },
        signal,
      );
      return { status: "ready", data };
    },
    { ...client.cacheOptions?.slotInstances, ...settings, abortOnUnsubscribe: true },
  );
  let last: FetchSnapshot<Result> | undefined;
  let snapshot: SlotInstancesSnapshot;
  return {
    getSnapshot(): SlotInstancesSnapshot {
      if (!activeView) return idle;
      const current = query.getSnapshot();
      if (current !== last) {
        snapshot = {
          data: current.data?.data,
          error: current.error,
          status: current.status === "ready" ? current.data!.status : current.status,
          isFetching: current.isFetching,
        };
        last = current;
      }
      return snapshot;
    },
    subscribe: (listener: () => void) => (activeView ? query.subscribe(listener) : () => {}),
    fetch: (fetchOptions: FetchOptions = {}) =>
      activeView ? query.fetch(fetchOptions) : Promise.resolve(),
    invalidate: query.invalidate,
  };
}
