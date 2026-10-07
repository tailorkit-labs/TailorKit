import type { ViewInstance } from "@tailorkit/app/client";
import type { ActiveView } from "@tailorkit/core/views";
import type { TailorKitFetchClient } from "../../client/fetch-client";
import { resolveSlotView } from "../../client/slot-view";
import type { TailorKitApp } from "../../types";
import type { FetchCacheOptions, FetchOptions, FetchSnapshot } from "./cache";

export interface SlotInstance extends ViewInstance {
  app: TailorKitApp;
}

export interface SlotInstancesStoreOptions extends FetchCacheOptions {
  apps: TailorKitApp[];
  slot: string;
  activeView: ActiveView | null;
  appsStatus?: FetchSnapshot<unknown>["status"];
  appsError?: Error | null;
}

export interface SlotInstancesSnapshot {
  data: SlotInstance[] | undefined;
  error: Error | null;
  status: FetchSnapshot<unknown>["status"];
  isFetching: boolean;
}

interface Result {
  status: "ready" | "loading";
  data?: SlotInstance[];
}

/** Match all app contexts before authorizing any app or sending instance requests. */
export function createSlotInstancesStore(
  client: TailorKitFetchClient,
  options: SlotInstancesStoreOptions,
) {
  const {
    apps,
    slot,
    activeView,
    staleTime,
    gcTime,
    appsStatus = "ready",
    appsError = null,
  } = options;
  const enabled = appsStatus === "ready" && activeView !== null;
  const settings = {
    ...(staleTime === undefined ? {} : { staleTime }),
    ...(gcTime === undefined ? {} : { gcTime }),
  };
  const waiting: SlotInstancesSnapshot = {
    data: undefined,
    error: appsStatus === "error" ? appsError : null,
    status: appsStatus === "error" ? "error" : activeView ? "loading" : "idle",
    isFetching: false,
  };
  const query = client.cache.getStore<Result>(
    ["tailorkit", client.baseUrl.toString(), "resolvedInstances", apps, slot, activeView],
    async (signal) => {
      const candidates = apps.filter((app) =>
        app.views?.some((view) => view.slot === slot && view.instances && !view.disabled),
      );
      if (!candidates.length) return { status: "ready", data: [] };
      const meta = client.meta();
      await meta.fetch();
      signal.throwIfAborted();
      const snapshot = meta.getSnapshot();
      if (snapshot.error) throw snapshot.error;
      if (!snapshot.data) throw new Error("TailorKit metadata is unavailable.");
      const schema = snapshot.data.schema;
      if (schema.slots[slot]?.multiple !== true)
        throw new Error(`Slot "${slot}" does not support instances.`);
      const matches = candidates.flatMap((app) => {
        const resolved = resolveSlotView(app.views ?? [], slot, activeView!, schema);
        return resolved?.instances ? [{ app, resolved }] : [];
      });
      for (const { resolved } of matches) {
        if (resolved.status === "error")
          throw new Error(`Context for view "${resolved.view}" is unavailable.`);
      }
      if (matches.some(({ resolved }) => resolved.status !== "ready")) return { status: "loading" };
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        const results = await Promise.all(
          matches.map(async ({ app, resolved }) => {
            if (resolved.status !== "ready") return [];
            const data = await client.endpoints.slotInstances(
              app,
              { slot, path: resolved.view, context: resolved.context },
              controller.signal,
            );
            return data.map((instance) => ({ ...instance, app }));
          }),
        );
        return { status: "ready", data: results.flat() };
      } catch (error) {
        controller.abort();
        throw error;
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
    { ...client.cacheOptions?.slotInstances, ...settings, abortOnUnsubscribe: true },
  );
  let last: FetchSnapshot<Result> | undefined;
  let snapshot: SlotInstancesSnapshot;
  return {
    getSnapshot(): SlotInstancesSnapshot {
      if (!enabled) return waiting;
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
    subscribe: (listener: () => void) => (enabled ? query.subscribe(listener) : () => {}),
    fetch: (fetchOptions: FetchOptions = {}) =>
      enabled ? query.fetch(fetchOptions) : Promise.resolve(),
    invalidate: () => (enabled ? query.invalidate() : Promise.resolve()),
  };
}
