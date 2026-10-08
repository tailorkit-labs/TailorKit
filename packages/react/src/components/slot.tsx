import { useStore } from "@nanostores/react";
import type { ViewInstance } from "@tailorkit/app/client";
import type { SlotDefinitions, ViewDefinition } from "@tailorkit/core/schema";
import type { ActiveView, ViewStatus } from "@tailorkit/core/views";
import { useEffect, useId, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { ViewContext, ViewName } from "../hooks/use-view-context";
import { useStableContext } from "../hooks/use-stable-context";
import { useAppSlot } from "../hooks/use-views";
import { buildThemeCss, PrimitiveThemeContext } from "../primitives";
import { RemoteViewHost } from "../remote-view";
import { resolveSlotView, selectSlotView, toBaseUrl } from "@tailorkit/client-core";
import type { SlotItem } from "@tailorkit/client-core";
import type { TailorKitApp } from "../tailorkit";
import { useTailorRootContext } from "./context";

type DefaultViews = Record<`/${string}`, ViewDefinition>;
type ContextPaths<TViews extends Record<string, ViewDefinition>, TView extends ViewName<TViews>> = {
  [P in ViewName<TViews>]: P extends "/" | TView ? P : TView extends `${P}/${string}` ? P : never;
}[ViewName<TViews>];
type ContextFields<TView> =
  undefined extends ViewContext<TView>
    ? Partial<Exclude<ViewContext<TView>, undefined>>
    : ViewContext<TView>;

export type SlotContext<
  TViews extends Record<string, ViewDefinition>,
  TView extends ViewName<TViews>,
> = {
  [P in ContextPaths<TViews, TView>]: (context: ContextFields<TViews[P]>) => void;
}[ContextPaths<TViews, TView>] extends (context: infer TContext) => void
  ? TContext
  : never;

interface RuntimeSlotProps {
  app: TailorKitApp;
  /** The host slot to render in. */
  name: string;
  /** Select an instance of the matching view. */
  instanceKey?: string;
}

type InstanceProps<TSlot, TKey extends string, TValue> = boolean extends (
  TSlot extends { multiple?: infer T } ? T : false
)
  ? { [K in TKey]?: TValue }
  : TSlot extends { multiple: true }
    ? { [K in TKey]: TValue }
    : { [K in TKey]?: never };

export type SlotProps<TSlots extends SlotDefinitions = SlotDefinitions> = {
  [TSlot in keyof TSlots & string]: { app: TailorKitApp; name: TSlot } & InstanceProps<
    TSlots[TSlot],
    "instanceKey",
    string
  >;
}[keyof TSlots & string];

export type ControlledSlotProps<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TSlots extends SlotDefinitions = SlotDefinitions,
> = {
  [TSlot in keyof TSlots & string]: {
    [TView in Extract<ViewName<TViews>, TSlots[TSlot]["views"][number]>]: {
      app: TailorKitApp;
      name: TSlot;
      view: TView;
    } & (
      | ({ context: SlotContext<TViews, TView>; status: "ready" } & InstanceProps<
          TSlots[TSlot],
          "instance",
          ViewInstance
        >)
      | { context?: never; status: "loading" | "error"; instance?: never }
    );
  }[Extract<ViewName<TViews>, TSlots[TSlot]["views"][number]>];
}[keyof TSlots & string];

export type SlotComponent<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TSlots extends SlotDefinitions = SlotDefinitions,
> = ((props: SlotProps<TSlots>) => ReactNode) & {
  Controlled: (props: ControlledSlotProps<TViews, TSlots>) => ReactNode;
};

type SlotState =
  | ActiveView
  | {
      view: string;
      controlled: true;
      context?: unknown;
      status: ViewStatus;
      instance?: ViewInstance;
    };

function ManagedSlot({ app, name, instanceKey }: RuntimeSlotProps): ReactNode {
  const { store } = useTailorRootContext("Slot");
  const state = useStore(store.views.state);

  if (state === null) return null;
  return instanceKey === undefined ? (
    <SlotRenderer app={app} name={name} state={state} />
  ) : (
    <InstanceSlot app={app} name={name} instanceKey={instanceKey} state={state} />
  );
}

function InstanceSlot({
  app,
  name,
  instanceKey,
  state,
}: RuntimeSlotProps & { instanceKey: string; state: ActiveView }): ReactNode {
  const { store } = useTailorRootContext("Slot");
  const instances = useAppSlot(app, name);
  const meta = useStore(store.fetch.meta.state);
  const instance = instances.data?.find(
    (item): item is SlotItem<true> => "key" in item && item.key === instanceKey,
  );
  const resolved =
    instances.isSuccess && instance && meta.schema
      ? resolveSlotView(app.views ?? [], name, state, meta.schema)
      : null;
  const view = resolved?.status === "ready" ? resolved.view : undefined;
  const stableContext = useStableContext(resolved?.context);
  const stableInstance = useStableContext(
    instance ? { key: instance.key, metadata: instance.metadata, data: instance.data } : undefined,
  );
  const readyState = useMemo<SlotState | null>(
    () =>
      view === undefined || !stableInstance
        ? null
        : {
            controlled: true,
            view,
            context: stableContext,
            status: "ready",
            instance: stableInstance,
          },
    [view, stableContext, stableInstance],
  );

  if (instances.isPending) return <div role="status">Loading view…</div>;
  if (instances.error) return <div role="alert">{instances.error.message}</div>;
  if (meta.schema && meta.schema.slots[name]?.multiple !== true)
    return <div role="alert">Slot "{name}" does not support instances.</div>;
  if (!instance) return <div role="alert">View instance "{instanceKey}" is unavailable.</div>;
  if (!readyState) return null;
  return <SlotRenderer app={app} name={name} state={readyState} />;
}

function ControlledSlot({
  app,
  name,
  view,
  context,
  status,
  instance,
}: ControlledSlotProps): ReactNode {
  useTailorRootContext("Slot.Controlled");
  const stableContext = useStableContext(context);
  const stableInstance = useStableContext(instance);
  const state = useMemo(
    () => ({
      controlled: true as const,
      view,
      context: stableContext,
      status,
      ...(status === "ready" && stableInstance ? { instance: stableInstance } : {}),
    }),
    [view, stableContext, status, stableInstance],
  );

  if (
    status === "ready" &&
    !instance &&
    app.views?.some(
      (entry) => entry.slot === name && entry.path === view && entry.instances && !entry.disabled,
    )
  ) {
    return <div role="alert">A view instance is required. Pass instance to Slot.Controlled.</div>;
  }
  return <SlotRenderer app={app} name={name} state={state} />;
}

export const Slot: SlotComponent = Object.assign(ManagedSlot, { Controlled: ControlledSlot });

// Both public components share the runtime; only the managed Slot reads the view registry.
function SlotRenderer({ app, name, state }: RuntimeSlotProps & { state: SlotState }): ReactNode {
  const { store, client } = useTailorRootContext("Slot");
  const reactId = useId();
  const getBackendSession = useMemo(
    () => store.client.endpoints.getSessionProvider(app),
    [store.client, app.id, app.currentDeployment?.id, app.preview?.sessionId],
  );
  const meta = useStore(store.fetch.meta.state);
  const previewSessionId = app.preview?.sessionId ?? "";
  const appRef = useRef(app);
  appRef.current = app;
  const previewStore = useMemo(
    () => store.previews.getStore(() => appRef.current),
    [store, previewSessionId],
  );
  const preview = useStore(previewStore);
  const props = useMemo(
    () => ({
      ...state,
      slot: name,
      declaredViews: Object.keys(meta.schema?.views ?? {}),
      supportedViews: meta.schema?.slots[name]?.views ?? [],
    }),
    [state, name, meta.schema],
  );
  const appUrl = useMemo(() => {
    if (app.clientPath) return new URL(app.clientPath, store.baseUrl);
    if (!meta.assetsBaseUrl || !app.projectId || !app.currentDeployment?.id) return null;
    return new URL(
      `projects/${app.projectId}/apps/${app.id}/deployments/${app.currentDeployment.id}/client/client.js`,
      toBaseUrl(meta.assetsBaseUrl),
    );
  }, [app, store.baseUrl, meta.assetsBaseUrl]);

  useEffect(() => {
    void store.fetchMeta();
  }, [store]);
  useEffect(() => {
    store.previews.updateApp(app);
  }, [store, app]);

  if (meta.schema === null || (appUrl === null && preview.source === null)) return null;
  const multiple = meta.schema.slots[name]?.multiple === true;
  if ("controlled" in state && state.status === "ready") {
    if (multiple && !state.instance)
      return <div role="alert">A view instance is required. Pass instance to Slot.Controlled.</div>;
    if (!multiple && state.instance)
      return <div role="alert">Slot "{name}" does not support instances.</div>;
  }
  if (!("controlled" in state)) {
    const selected = selectSlotView(app.views ?? [], name, state.view, meta.schema);
    if (selected?.instances && !multiple)
      return <div role="alert">Slot "{name}" does not support instances.</div>;
    if (multiple)
      return <div role="alert">A view instance key is required. Pass instanceKey to Slot.</div>;
  }

  const viewId = `tailorkit-view-${reactId.replaceAll(":", "")}`;
  return (
    <PrimitiveThemeContext.Provider value={{ viewId, theme: client.theme }}>
      <div data-tailorkit-view={viewId}>
        <style data-tailorkit-theme-style={viewId}>{buildThemeCss(viewId, client.theme)}</style>
        <RemoteViewHost
          key={preview.revision || appUrl?.toString()}
          appUrl={(
            appUrl ?? new URL(`preview/${previewSessionId}/client.js`, store.baseUrl)
          ).toString()}
          sourceText={preview.source ?? undefined}
          getBackendSession={getBackendSession}
          components={client.components}
          props={props}
        />
      </div>
    </PrimitiveThemeContext.Provider>
  );
}
