import { createClient, createSessionProvider, reference } from "@tailorkit/app/client";
import type { Client, ViewInstance } from "@tailorkit/app/client";
import { resolveSlotView } from "../slot-view";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTailorRootContext } from "../components/context";
import type { TailorKitApp } from "../tailorkit";
import type { UseAppsResult } from "./use-apps";
import { useStableContext } from "./use-stable-context";

export type SlotInstance = ViewInstance;

export interface UseSlotInstancesOptions<TSlot extends string = string> {
  app: TailorKitApp;
  slot: TSlot;
}

export interface UseSlotInstancesResult extends Omit<UseAppsResult, "data"> {
  data: SlotInstance[] | undefined;
}

const resolveInstances = reference<
  "action",
  { slot: string; path: string; context: Record<string, unknown> },
  SlotInstance[]
>("_tailorkit.instances.resolve", "action");

/** Fetch instances for the app's matching slot view using registered host context. */
export function useSlotInstances({ app, slot }: UseSlotInstancesOptions): UseSlotInstancesResult {
  const { store } = useTailorRootContext("useSlotInstances");
  const activeView = useSyncExternalStore(
    store.views.subscribe,
    store.views.getSnapshot,
    store.views.getSnapshot,
  );
  const request = useStableContext({
    baseUrl: store.baseUrl.toString(),
    appId: app.id,
    deploymentId: app.currentDeployment?.id,
    views: app.views ?? [],
    slot,
    activeView,
  });
  const getSession = useMemo(
    () => createSessionProvider({ baseUrl: store.baseUrl, appId: app.id }),
    [store, app.id, app.currentDeployment?.id],
  );
  const [snapshot, setSnapshot] = useState<{
    request: typeof request | null;
    data: SlotInstance[] | undefined;
    error: Error | null;
    status: UseSlotInstancesResult["status"];
  }>({
    request: null,
    data: undefined,
    error: null,
    status: "idle",
  });
  const generation = useRef(0);
  const backend = useRef<Client | null>(null);

  const refetch = useCallback(async () => {
    const id = ++generation.current;
    backend.current?.close();
    backend.current = null;
    const publish = (
      status: UseSlotInstancesResult["status"],
      data?: SlotInstance[],
      error: Error | null = null,
    ) => {
      if (id === generation.current) {
        setSnapshot({
          request,
          status,
          data,
          error,
        });
      }
    };
    if (!request.activeView) {
      publish("idle");
      return;
    }
    if (!request.views.some((view) => view.slot === slot && view.instances && !view.disabled)) {
      publish("ready", []);
      return;
    }
    publish("loading");
    let client: Client | undefined;
    try {
      await store.fetchMeta({ force: store.getMetaSnapshot().status === "error" });
      if (id !== generation.current) return;
      const meta = store.getMetaSnapshot();
      if (meta.error) throw meta.error;
      if (!meta.schema) throw new Error("TailorKit metadata is unavailable.");
      if (meta.schema.slots[slot]?.multiple !== true)
        throw new Error(`Slot "${slot}" does not support instances.`);
      const resolved = resolveSlotView(request.views, slot, request.activeView, meta.schema);
      if (!resolved?.instances) {
        publish("ready", []);
        return;
      }
      if (resolved.status !== "ready") {
        if (resolved.status === "error")
          throw new Error(`Context for view "${resolved.view}" is unavailable.`);
        publish("loading");
        return;
      }
      client = createClient({ getSession });
      backend.current = client;
      const instances = await client.action(resolveInstances, {
        slot,
        path: resolved.view,
        context: resolved.context,
      });
      publish("ready", instances);
    } catch (error) {
      publish("error", undefined, error instanceof Error ? error : new Error(String(error)));
    } finally {
      client?.close();
      if (backend.current === client) backend.current = null;
    }
  }, [request, store, slot, getSession]);

  useEffect(() => {
    void refetch();
    return () => {
      generation.current += 1;
      backend.current?.close();
      backend.current = null;
    };
  }, [refetch]);

  // Never expose a previous app or context's data while its replacement request starts.
  const status = snapshot.request === request ? snapshot.status : activeView ? "loading" : "idle";
  return {
    data: snapshot.request === request ? snapshot.data : undefined,
    error: snapshot.request === request ? snapshot.error : null,
    status,
    isPending: status === "idle" || status === "loading",
    isLoading: status === "loading",
    isSuccess: status === "ready",
    isError: status === "error",
    refetch,
  };
}
