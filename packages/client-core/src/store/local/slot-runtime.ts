import { atom } from "nanostores";
import type { Session, ViewInstance } from "@tailorkit/app/client";
import type { ViewStatus } from "@tailorkit/core/views";
import type { RuntimeRenderSlotProps, SlotState } from "../../client/slot-types";
import { resolveSlotView, selectSlotView } from "../../client/slot-view";
import { toBaseUrl } from "../../client/url";
import { createValueMemo } from "../../client/value-memo";
import { createAppViewsQuery } from "../query";
import type { SlotItem } from "../fetch/slot";
import { createSnapshotStore } from "../snapshot-store";
import { serializeCacheKey } from "../fetch/cache";
import type { TailorKitStore } from "../store";

export type SlotRuntimeOptions = RuntimeRenderSlotProps &
  (
    | { mode: "managed" }
    | {
        mode: "controlled";
        view: string;
        context?: unknown;
        status: ViewStatus;
        instance?: ViewInstance;
      }
  );

export type SlotRuntimeSnapshot =
  | { status: "hidden" }
  | { status: "loading"; message: string }
  | { status: "error"; error: Error }
  | {
      status: "render";
      appUrl: string;
      sourceText?: string;
      hostKey: string | number;
      props: Record<string, unknown>;
      getBackendSession: (options: { refresh: boolean }) => Promise<Session>;
    };

const hidden: SlotRuntimeSnapshot = { status: "hidden" };
const loading: SlotRuntimeSnapshot = { status: "loading", message: "Loading view…" };
const failure = (message: string): SlotRuntimeSnapshot => ({
  status: "error",
  error: new Error(message),
});

/** Resolve a managed or controlled slot; adapters only render its snapshot. */
export function createSlotRuntime(store: TailorKitStore, initial: SlotRuntimeOptions) {
  const memoInput = createValueMemo<SlotRuntimeOptions>();
  const input = atom(memoInput(initial));
  let queryKey: string | undefined;
  let query: ReturnType<typeof createAppViewsQuery> | null = null;
  let previewSession: string | undefined;
  let preview: ReturnType<typeof store.previews.getStore>;
  let previousSnapshot: SlotRuntimeSnapshot;
  let snapshotKey: string | undefined;

  const getQuery = () => {
    const options = input.get();
    if (
      options.mode !== "managed" ||
      options.instanceKey === undefined ||
      store.views.state.get() === null
    )
      return null;
    const key = serializeCacheKey([options.app, options.slot]);
    if (key !== queryKey) {
      queryKey = key;
      query = createAppViewsQuery(store, options.app, options.slot);
    }
    return query;
  };
  const getPreview = () => {
    const session = input.get().app.preview?.sessionId ?? "";
    if (session !== previewSession) {
      previewSession = session;
      preview = store.previews.getStore(() => input.get().app);
    }
    return preview;
  };
  const resolve = (): SlotRuntimeSnapshot => {
    const options = input.get();
    const { app, slot } = options;
    const active = store.views.state.get();
    let viewState: SlotState;
    if (options.mode === "managed") {
      if (active === null) return hidden;
      viewState = active;
      if (options.instanceKey !== undefined) {
        const instances = getQuery()!.state.get();
        if (instances.isPending) return loading;
        if (instances.error) return { status: "error", error: instances.error };
        const schema = store.contract;
        if (schema.slots[slot]?.multiple !== true)
          return failure(`Slot "${slot}" does not support instances.`);
        const instance = instances.data?.find(
          (item): item is SlotItem<true> => "key" in item && item.key === options.instanceKey,
        );
        if (!instance) return failure(`View instance "${options.instanceKey}" is unavailable.`);
        const resolved = instances.isSuccess
          ? resolveSlotView(app.views ?? [], slot, active, schema)
          : null;
        if (resolved?.status !== "ready") return hidden;
        viewState = {
          controlled: true,
          view: resolved.view,
          context: resolved.context,
          status: "ready",
          instance: { key: instance.key, metadata: instance.metadata, data: instance.data },
        };
      }
    } else {
      viewState = {
        controlled: true,
        view: options.view,
        status: options.status,
        context: options.status === "ready" ? options.context : undefined,
        ...(options.status === "ready" && options.instance ? { instance: options.instance } : {}),
      };
      if (
        options.status === "ready" &&
        !options.instance &&
        app.views?.some(
          (view) =>
            view.slot === slot && view.path === options.view && view.instances && !view.disabled,
        )
      ) {
        return failure("A view instance is required. Pass instance to RenderSlot.Controlled.");
      }
    }
    const schema = store.contract;
    const source = getPreview().get();
    const appUrl = app.clientPath
      ? new URL(app.clientPath, store.baseUrl)
      : store.assetsBaseUrl && app.projectId && app.currentDeployment?.id
        ? new URL(
            `projects/${app.projectId}/apps/${app.id}/deployments/${app.currentDeployment.id}/client/client.js`,
            toBaseUrl(store.assetsBaseUrl),
          )
        : null;
    if (appUrl === null && source.source === null) return hidden;
    const multiple = schema.slots[slot]?.multiple === true;
    if ("controlled" in viewState && viewState.status === "ready") {
      if (multiple && !viewState.instance)
        return failure("A view instance is required. Pass instance to RenderSlot.Controlled.");
      if (!multiple && viewState.instance)
        return failure(`Slot "${slot}" does not support instances.`);
    }
    if (!("controlled" in viewState)) {
      const selected = selectSlotView(app.views ?? [], slot, viewState.view, schema);
      if (selected?.instances && !multiple)
        return failure(`Slot "${slot}" does not support instances.`);
      if (multiple)
        return failure("A view instance key is required. Pass instanceKey to RenderSlot.");
    }
    return {
      status: "render",
      appUrl: (
        appUrl ?? new URL(`preview/${app.preview?.sessionId ?? ""}/client.js`, store.baseUrl)
      ).toString(),
      sourceText: source.source ?? undefined,
      hostKey: source.revision || appUrl?.toString() || `preview/${app.preview?.sessionId ?? ""}`,
      props: {
        ...viewState,
        slot,
        declaredViews: Object.keys(schema.views),
        supportedViews: schema.slots[slot]?.views ?? [],
      },
      getBackendSession: store.client.endpoints.getSessionProvider(app),
    };
  };
  const state = createSnapshotStore(
    () => {
      const snapshot = resolve();
      const key =
        snapshot.status === "error"
          ? JSON.stringify(["error", snapshot.error.message])
          : JSON.stringify(snapshot);
      if (
        key !== snapshotKey ||
        (snapshot.status === "render" &&
          previousSnapshot?.status === "render" &&
          snapshot.getBackendSession !== previousSnapshot.getBackendSession)
      ) {
        snapshotKey = key;
        previousSnapshot = snapshot;
      }
      return previousSnapshot;
    },
    (listener) => {
      let active = true;
      let updating = false;
      let queued = false;
      let observedQuery: typeof query = null;
      let observedPreview: typeof preview | null = null;
      let stopQuery: (() => void) | undefined;
      let stopPreview: (() => void) | undefined;
      const refresh = () => {
        if (!active) return;
        if (updating) {
          queued = true;
          return;
        }
        updating = true;
        do {
          queued = false;
          const nextQuery = getQuery();
          if (nextQuery !== observedQuery) {
            const stopPrevious = stopQuery;
            observedQuery = nextQuery;
            stopQuery = nextQuery?.state.listen(refresh);
            stopPrevious?.();
          }
          const hasView = input.get().mode === "controlled" || store.views.state.get() !== null;
          const nextPreview = hasView ? getPreview() : null;
          if (nextPreview !== observedPreview) {
            const stopPrevious = stopPreview;
            observedPreview = nextPreview;
            stopPreview = nextPreview?.listen(refresh);
            stopPrevious?.();
          }
          listener();
        } while (queued && active);
        updating = false;
      };
      const stopInput = input.listen(refresh);
      const stopView = store.views.state.listen(refresh);
      refresh();
      return () => {
        active = false;
        stopInput();
        stopView();
        stopQuery?.();
        stopPreview?.();
      };
    },
  );
  return {
    state,
    setInput(options: SlotRuntimeOptions) {
      store.previews.updateApp(options.app);
      input.set(memoInput(options));
    },
  };
}
