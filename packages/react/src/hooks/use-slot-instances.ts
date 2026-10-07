import { createClient, createSessionProvider, reference } from "@tailorkit/app/client";
import type { Client, ViewInstance } from "@tailorkit/app/client";
import { resolveSlotView } from "../slot-view";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTailorRootContext } from "../components/context";
import type { TailorKitApp } from "../tailorkit";
import { useApps } from "./use-apps";
import type { UseAppsResult } from "./use-apps";
import { useStableContext } from "./use-stable-context";

export interface SlotInstance extends ViewInstance {
  app: TailorKitApp;
}

export interface UseSlotInstancesOptions<TSlot extends string = string> {
  slot: TSlot;
}

export interface UseSlotInstancesResult extends Omit<UseAppsResult, "data"> {
  data: SlotInstance[] | undefined;
}

const resolveInstances = reference<
  "action",
  { slot: string; path: string; context: Record<string, unknown> },
  ViewInstance[]
>("_tailorkit.instances.resolve", "action");

/** Fetch instances across all apps' matching slot views using registered host context. */
export function useSlotInstances({ slot }: UseSlotInstancesOptions): UseSlotInstancesResult {
  const apps = useApps();
  const instances = useResolvedSlotInstances(slot, apps.data, apps.status, apps.error);
  const refetch = useCallback(async () => {
    if (apps.isSuccess) await instances.refetch();
    else await apps.refetch();
  }, [apps.isSuccess, apps.refetch, instances.refetch]);
  return { ...instances, refetch };
}

/** Keep managed Slot resolution scoped to its explicitly supplied app. */
export function useAppSlotInstances(app: TailorKitApp, slot: string): UseSlotInstancesResult {
  return useResolvedSlotInstances(slot, [app], "ready", null);
}

function useResolvedSlotInstances(
  slot: string,
  apps: TailorKitApp[] | undefined,
  appsStatus: UseAppsResult["status"],
  appsError: Error | null,
): UseSlotInstancesResult {
  const { store } = useTailorRootContext("useSlotInstances");
  const activeView = useSyncExternalStore(
    store.views.subscribe,
    store.views.getSnapshot,
    store.views.getSnapshot,
  );
  const request = useStableContext({
    baseUrl: store.baseUrl.toString(),
    apps: apps ?? [],
    appsStatus,
    slot,
    activeView,
  });
  const sessionApps = useStableContext(
    request.apps.map((app) => ({ id: app.id, deploymentId: app.currentDeployment?.id })),
  );
  const sessions = useMemo(
    () =>
      new Map(
        sessionApps.map((app) => [
          app.id,
          createSessionProvider({ baseUrl: store.baseUrl, appId: app.id }),
        ]),
      ),
    [store, sessionApps],
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
  const backends = useRef(new Set<Client>());
  const closeBackends = useCallback(() => {
    for (const client of backends.current) client.close();
    backends.current.clear();
  }, []);

  const refetch = useCallback(async () => {
    const id = ++generation.current;
    closeBackends();
    const publish = (
      status: UseSlotInstancesResult["status"],
      data?: SlotInstance[],
      error: Error | null = null,
    ) => {
      if (id === generation.current) {
        setSnapshot({ request, status, data, error });
      }
    };
    if (request.appsStatus === "error") {
      publish("error", undefined, appsError);
      return;
    }
    const activeView = request.activeView;
    if (!activeView) {
      publish("idle");
      return;
    }
    if (request.appsStatus !== "ready") {
      publish("loading");
      return;
    }
    const candidates = request.apps.filter((app) =>
      app.views?.some((view) => view.slot === slot && view.instances && !view.disabled),
    );
    if (candidates.length === 0) {
      publish("ready", []);
      return;
    }
    publish("loading");
    try {
      await store.fetchMeta({ force: store.getMetaSnapshot().status === "error" });
      if (id !== generation.current) return;
      const meta = store.getMetaSnapshot();
      if (meta.error) throw meta.error;
      const schema = meta.schema;
      if (!schema) throw new Error("TailorKit metadata is unavailable.");
      if (schema.slots[slot]?.multiple !== true)
        throw new Error(`Slot "${slot}" does not support instances.`);
      const matches = candidates.flatMap((app) => {
        const resolved = resolveSlotView(app.views ?? [], slot, activeView, schema);
        return resolved?.instances ? [{ app, resolved }] : [];
      });
      for (const { resolved } of matches) {
        if (resolved.status === "error")
          throw new Error(`Context for view "${resolved.view}" is unavailable.`);
      }
      if (matches.some(({ resolved }) => resolved.status !== "ready")) return;
      const results = await Promise.all(
        matches.map(async ({ app, resolved }) => {
          if (resolved.status !== "ready") return [];
          const client = createClient({ getSession: sessions.get(app.id)! });
          backends.current.add(client);
          try {
            const instances = await client.action(resolveInstances, {
              slot,
              path: resolved.view,
              context: resolved.context,
            });
            return instances.map((instance) => ({ ...instance, app }));
          } finally {
            client.close();
            backends.current.delete(client);
          }
        }),
      );
      publish("ready", results.flat());
    } catch (error) {
      if (id === generation.current) closeBackends();
      publish("error", undefined, error instanceof Error ? error : new Error(String(error)));
    }
  }, [request, appsError, store, slot, sessions, closeBackends]);

  useEffect(() => {
    void refetch();
    return () => {
      generation.current += 1;
      closeBackends();
    };
  }, [refetch, closeBackends]);

  // Never expose a previous app list or context's data while its replacement request starts.
  const status =
    appsStatus === "error"
      ? "error"
      : snapshot.request === request
        ? snapshot.status
        : activeView
          ? "loading"
          : "idle";
  return {
    data: snapshot.request === request ? snapshot.data : undefined,
    error:
      appsStatus === "error" ? appsError : snapshot.request === request ? snapshot.error : null,
    status,
    isPending: status === "idle" || status === "loading",
    isLoading: status === "loading",
    isSuccess: status === "ready",
    isError: status === "error",
    refetch,
  };
}
