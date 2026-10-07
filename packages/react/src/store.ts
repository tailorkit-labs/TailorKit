import type { TailorKitSchemaSpecType } from "@tailorkit/core/spec";
import type { TailorKitApp, TailorKitView } from "./tailorkit";
import { createViewRegistry } from "./view-registry";
import { createPreviewManager } from "./preview-manager";

export interface TailorKitAppsSnapshot {
  apps: TailorKitApp[];
  views: TailorKitView[];
  error: Error | null;
  status: "error" | "idle" | "loading" | "ready";
}

interface TailorKitMetaSnapshot {
  assetsBaseUrl: string | null;
  error: Error | null;
  schema: TailorKitSchemaSpecType | null;
  status: "error" | "idle" | "loading" | "ready";
}

export type TailorKitStore = ReturnType<typeof createTailorKitStore>;

export function createTailorKitStore(baseUrlInput: string | URL, initialApps?: TailorKitApp[]) {
  const baseUrl = toBaseUrl(baseUrlInput);
  const listeners = new Set<() => void>();
  let providedApps = initialApps;
  let appsSnapshot: TailorKitAppsSnapshot = {
    apps: initialApps ?? [],
    views: listViews(initialApps ?? []),
    error: null,
    status: initialApps === undefined ? "idle" : "ready",
  };
  let appsPromise: Promise<void> | null = null;
  let appsRequestId = 0;
  let appsRequested = false;
  let appsSubscribers = 0;
  let metaSnapshot: TailorKitMetaSnapshot = {
    assetsBaseUrl: null,
    error: null,
    schema: null,
    status: "idle",
  };
  let fetchMetaPromise: Promise<void> | null = null;
  let metaRequestId = 0;

  const emit = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const store = {
    baseUrl,
    views: createViewRegistry(),
    setProvidedApps(apps: TailorKitApp[] | undefined) {
      if (providedApps === apps) {
        return;
      }
      providedApps = apps;
      appsRequestId += 1;
      appsPromise = null;
      appsSnapshot = {
        apps: apps ?? [],
        views: listViews(apps ?? []),
        error: null,
        status: apps === undefined ? "idle" : "ready",
      };
      emit();
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
      appsSnapshot = { ...appsSnapshot, error: null, status: "loading" };
      emit();
      const requestId = ++appsRequestId;
      appsPromise = fetch(new URL("apps", baseUrl))
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Unable to fetch TailorKit apps from ${baseUrl.toString()}.`);
          }
          const apps = (await response.json()) as TailorKitApp[];
          if (requestId !== appsRequestId) return;
          appsSnapshot = { apps, views: listViews(apps), error: null, status: "ready" };
          emit();
        })
        .catch((error: unknown) => {
          if (requestId !== appsRequestId) return;
          appsSnapshot = {
            ...appsSnapshot,
            error: error instanceof Error ? error : new Error(String(error)),
            status: "error",
          };
          emit();
        });
      return appsPromise;
    },
    fetchMeta: (options: { force?: boolean } = {}): Promise<void> => {
      if (fetchMetaPromise && !options.force) {
        return fetchMetaPromise;
      }

      metaSnapshot = { ...metaSnapshot, error: null, status: "loading" };
      emit();

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
          metaSnapshot = {
            assetsBaseUrl: meta.assetsBaseUrl ?? null,
            error: null,
            schema: meta.schema,
            status: "ready",
          };
          emit();
        })
        .catch((error: unknown) => {
          if (requestId !== metaRequestId) return;
          metaSnapshot = {
            ...metaSnapshot,
            error: error instanceof Error ? error : new Error(String(error)),
            status: "error",
          };
          emit();
        });

      return fetchMetaPromise;
    },
    getAppsSnapshot: (): TailorKitAppsSnapshot => appsSnapshot,
    getMetaSnapshot: (): TailorKitMetaSnapshot => metaSnapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeApps: (listener: () => void): (() => void) => {
      appsSubscribers += 1;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
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
        const apps = appsSnapshot.apps.map((app) => (app.id === appId ? { ...app, views } : app));
        appsSnapshot = { ...appsSnapshot, apps, views: listViews(apps) };
        emit();
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
