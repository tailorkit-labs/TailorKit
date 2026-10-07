import { createStore } from "@tanstack/store";
import type { TailorKitSchemaSpecType } from "@tailorkit/core/spec";
import type { TailorKitApp, TailorKitView } from "../types";
import { createViewRegistry } from "./view-registry";
import { createPreviewManager } from "./preview-manager";

export interface TailorKitAppsSnapshot {
  apps: TailorKitApp[];
  views: TailorKitView[];
  error: Error | null;
  status: "error" | "idle" | "loading" | "ready";
}

export interface TailorKitMetaSnapshot {
  assetsBaseUrl: string | null;
  error: Error | null;
  schema: TailorKitSchemaSpecType | null;
  status: "error" | "idle" | "loading" | "ready";
}

export interface TailorKitSnapshot {
  apps: TailorKitAppsSnapshot;
  meta: TailorKitMetaSnapshot;
}

export type TailorKitStore = ReturnType<typeof createTailorKitStore>;

export function createTailorKitStore(baseUrlInput: string | URL, initialApps?: TailorKitApp[]) {
  const baseUrl = toBaseUrl(baseUrlInput);
  let providedApps = initialApps;
  const state = createStore<TailorKitSnapshot>({
    apps: {
      apps: initialApps ?? [],
      views: listViews(initialApps ?? []),
      error: null,
      status: initialApps === undefined ? "idle" : "ready",
    },
    meta: {
      assetsBaseUrl: null,
      error: null,
      schema: null,
      status: "idle",
    },
  });
  let appsPromise: Promise<void> | null = null;
  let appsRequestId = 0;
  let appsRequested = false;
  let appsSubscribers = 0;
  let fetchMetaPromise: Promise<void> | null = null;
  let metaRequestId = 0;

  const store = {
    baseUrl,
    state,
    views: createViewRegistry(),
    setProvidedApps(apps: TailorKitApp[] | undefined) {
      if (providedApps === apps) {
        return;
      }
      providedApps = apps;
      appsRequestId += 1;
      appsPromise = null;
      state.setState((previous) => ({
        ...previous,
        apps: {
          apps: apps ?? [],
          views: listViews(apps ?? []),
          error: null,
          status: apps === undefined ? "idle" : "ready",
        },
      }));
      if (apps === undefined && appsRequested && appsSubscribers > 0) {
        void store.fetchApps();
      }
    },
    fetchApps: (options: { force?: boolean } = {}): Promise<void> => {
      appsRequested = true;
      if (providedApps !== undefined) {
        return Promise.resolve();
      }
      if (appsPromise && !options.force) {
        return appsPromise;
      }
      state.setState((previous) => ({
        ...previous,
        apps: { ...previous.apps, error: null, status: "loading" },
      }));
      const requestId = ++appsRequestId;
      appsPromise = fetch(new URL("apps", baseUrl))
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Unable to fetch TailorKit apps from ${baseUrl.toString()}.`);
          }
          const apps = (await response.json()) as TailorKitApp[];
          if (requestId !== appsRequestId) return;
          state.setState((previous) => ({
            ...previous,
            apps: { apps, views: listViews(apps), error: null, status: "ready" },
          }));
        })
        .catch((error: unknown) => {
          if (requestId !== appsRequestId) return;
          state.setState((previous) => ({
            ...previous,
            apps: {
              ...previous.apps,
              error: error instanceof Error ? error : new Error(String(error)),
              status: "error",
            },
          }));
        });
      return appsPromise;
    },
    fetchMeta: (options: { force?: boolean } = {}): Promise<void> => {
      if (fetchMetaPromise && !options.force) {
        return fetchMetaPromise;
      }

      state.setState((previous) => ({
        ...previous,
        meta: { ...previous.meta, error: null, status: "loading" },
      }));

      const requestId = ++metaRequestId;
      fetchMetaPromise = fetch(new URL("meta", baseUrl))
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Unable to fetch TailorKit metadata from ${baseUrl.toString()}.`);
          }
          const meta = (await response.json()) as {
            assetsBaseUrl?: string | null;
            schema: TailorKitSchemaSpecType;
          };
          if (requestId !== metaRequestId) return;
          state.setState((previous) => ({
            ...previous,
            meta: {
              assetsBaseUrl: meta.assetsBaseUrl ?? null,
              error: null,
              schema: meta.schema,
              status: "ready",
            },
          }));
        })
        .catch((error: unknown) => {
          if (requestId !== metaRequestId) return;
          state.setState((previous) => ({
            ...previous,
            meta: {
              ...previous.meta,
              error: error instanceof Error ? error : new Error(String(error)),
              status: "error",
            },
          }));
        });

      return fetchMetaPromise;
    },
    getAppsSnapshot: (): TailorKitAppsSnapshot => state.state.apps,
    getMetaSnapshot: (): TailorKitMetaSnapshot => state.state.meta,
    subscribe: (listener: () => void): (() => void) => state.subscribe(listener).unsubscribe,
    subscribeApps: (listener: () => void): (() => void) => {
      appsSubscribers += 1;
      const { unsubscribe } = state.subscribe(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        unsubscribe();
        appsSubscribers -= 1;
      };
    },
  };
  return {
    ...store,
    previews: createPreviewManager(
      baseUrl,
      () => {
        if (appsRequested) void store.fetchApps({ force: true });
      },
      (appId, views) => {
        state.setState((previous) => {
          const apps = previous.apps.apps.map((app) =>
            app.id === appId ? { ...app, views } : app,
          );
          return { ...previous, apps: { ...previous.apps, apps, views: listViews(apps) } };
        });
      },
    ),
  };
}

export function toBaseUrl(value: string | URL): URL {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function listViews(apps: TailorKitApp[]): TailorKitView[] {
  return apps.flatMap((app) =>
    (app.views ?? [])
      .filter((view) => !view.disabled)
      .map(({ slot, path, instances }) => ({
        id: JSON.stringify([app.id, slot, path]),
        ...(instances ? { instances } : {}),
        app,
        slot,
        path,
      })),
  );
}
