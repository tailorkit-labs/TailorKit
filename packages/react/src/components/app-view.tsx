import { createSessionProvider } from "@tailorkit/app/client";
import { useCallback, useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { isViewAncestor } from "@tailorkit/core/views";
import { toBaseUrl } from "../store";
import { useStableContext } from "../hooks/use-stable-context";
import { useTailorRootContext } from "./context";
import { buildThemeCss, PrimitiveThemeContext } from "../primitives";
import { RemoteViewHost } from "../remote-view";
import type { AppViewProps, TailorKitApp } from "../tailorkit";

export const AppView = ({
  app,
  slot,
  createIframe,
  fallback = null,
  ...viewProps
}: AppViewProps): ReactNode => {
  const { store, client } = useTailorRootContext("AppView");
  const { theme, components: wrappedComponents } = client;
  const reactId = useId();
  const getBackendSession = useMemo(
    () => createSessionProvider({ baseUrl: store.baseUrl, appId: app.id }),
    [store.baseUrl, app.id],
  );
  const currentView = useSyncExternalStore(
    store.views.subscribe,
    store.views.getSnapshot,
    store.views.getSnapshot,
  );
  const view = (viewProps as { view?: string }).view;
  const suppliedContext = (viewProps as { context?: unknown }).context;
  const context = useStableContext(suppliedContext);
  const status = (viewProps as { status?: "error" | "loading" | "ready" }).status ?? "ready";
  const props = useMemo(() => {
    if (view !== undefined) {
      return {
        slot,
        view,
        layers: [
          ...(currentView?.layers ?? []).filter(
            (layer) => layer.path !== view && isViewAncestor(layer.path, view),
          ),
          { path: view, context, status },
        ],
      };
    }
    return currentView === null ? undefined : { slot, ...currentView };
  }, [context, currentView, view, status, slot]);
  const meta = useSyncExternalStore(store.subscribe, store.getMetaSnapshot, store.getMetaSnapshot);
  const previewSessionId = app.preview?.sessionId ?? "";
  const appRef = useRef(app);
  appRef.current = app;
  const subscribePreview = useCallback(
    (listener: () => void) => {
      const currentApp = appRef.current;
      return currentApp.preview?.sessionId === previewSessionId
        ? store.previews.subscribe(currentApp, listener)
        : () => {};
    },
    [store, previewSessionId],
  );
  const getPreviewSnapshot = useCallback(
    () => store.previews.getSnapshot(previewSessionId),
    [store, previewSessionId],
  );
  const previewSnapshot = useSyncExternalStore(
    subscribePreview,
    getPreviewSnapshot,
    getPreviewSnapshot,
  );
  useEffect(() => {
    store.previews.updateApp(app);
  }, [store, app]);
  const runtimeProps = useMemo(
    () =>
      props === undefined
        ? undefined
        : {
            ...props,
            declaredViews: Object.keys(meta.schema?.views ?? {}),
            supportedViews: meta.schema?.slots[slot]?.views ?? [],
          },
    [props, meta.schema, slot],
  );
  const assetsBaseUrl = app.clientPath ? null : meta.assetsBaseUrl;
  const appUrl = useMemo(
    () => resolveAppUrl(app, store.baseUrl, assetsBaseUrl),
    [app, assetsBaseUrl, store.baseUrl],
  );

  useEffect(() => {
    void store.fetchMeta();
  }, [store]);

  if (
    props === undefined ||
    (appUrl === null && previewSnapshot.source === null) ||
    meta.schema === null
  ) {
    return fallback;
  }

  const viewId = `tailorkit-view-${reactId.replaceAll(":", "")}`;

  return (
    <PrimitiveThemeContext.Provider value={{ viewId, theme }}>
      <div data-tailorkit-view={viewId}>
        <style data-tailorkit-theme-style={viewId}>{buildThemeCss(viewId, theme)}</style>
        <RemoteViewHost
          key={previewSnapshot.revision || appUrl?.toString()}
          appUrl={(
            appUrl ?? new URL(`preview/${previewSessionId}/client.js`, store.baseUrl)
          ).toString()}
          sourceText={previewSnapshot.source ?? undefined}
          getBackendSession={getBackendSession}
          components={wrappedComponents}
          createIframe={createIframe}
          props={runtimeProps}
        />
      </div>
    </PrimitiveThemeContext.Provider>
  );
};

function resolveAppUrl(app: TailorKitApp, baseUrl: URL, assetsBaseUrl: string | null): URL | null {
  if (app.clientPath) {
    return new URL(app.clientPath, baseUrl);
  }

  if (!assetsBaseUrl || !app.projectId || !app.currentDeployment?.id) {
    return null;
  }

  return new URL(
    `projects/${app.projectId}/apps/${app.id}/deployments/${app.currentDeployment.id}/client/client.js`,
    toBaseUrl(assetsBaseUrl),
  );
}
