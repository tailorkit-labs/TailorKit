import type { TailorKitSchemaSpecType } from "@tailorkit/core/spec";
import type { TailorKitApp } from "./tailorkit";
import { createViewRegistry } from "./view-registry";
import { createPreviewManager } from "./preview-manager";

export interface TailorKitAppsSnapshot {
  apps: TailorKitApp[];
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
    error: null,
    status: initialApps === undefined ? "idle" : "ready",
  };
  let metaSnapshot: TailorKitMetaSnapshot = {
    assetsBaseUrl: null,
    error: null,
    schema: null,
    status: "idle",
  };
  let fetchAppsPromise: Promise<void> | null = null;
  let fetchMetaPromise: Promise<void> | null = null;
  let fetchAppsRequestId = 0;

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
      fetchAppsRequestId += 1;
      fetchAppsPromise = null;
      appsSnapshot = {
        apps: apps ?? [],
        error: null,
        status: apps === undefined ? "idle" : "ready",
      };
      emit();
      if (apps === undefined) {
        void store.fetchApps();
      }
    },
    fetchApps: (options: { force?: boolean } = {}): Promise<void> => {
      if (providedApps !== undefined) {
        return Promise.resolve();
      }
      if (fetchAppsPromise && !options.force) {
        return fetchAppsPromise;
      }

      appsSnapshot = { ...appsSnapshot, status: "loading" };
      emit();

      const requestId = ++fetchAppsRequestId;

      const appsUrl = new URL("apps", baseUrl);
      fetchAppsPromise = fetch(appsUrl)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Unable to fetch TailorKit apps from ${baseUrl.toString()}.`);
          }
          const apps = (await response.json()) as TailorKitApp[];
          if (requestId !== fetchAppsRequestId) {
            return;
          }
          appsSnapshot = {
            apps,
            error: null,
            status: "ready",
          };
          emit();
        })
        .catch((error: unknown) => {
          if (requestId !== fetchAppsRequestId) {
            return;
          }
          appsSnapshot = {
            ...appsSnapshot,
            error: error instanceof Error ? error : new Error(String(error)),
            status: "error",
          };
          emit();
        });

      return fetchAppsPromise;
    },
    fetchMeta: (): Promise<void> => {
      if (fetchMetaPromise) {
        return fetchMetaPromise;
      }

      metaSnapshot = { ...metaSnapshot, status: "loading" };
      emit();

      fetchMetaPromise = fetch(new URL("meta", baseUrl))
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Unable to fetch TailorKit metadata from ${baseUrl.toString()}.`);
          }
          const meta = (await response.json()) as {
            assetsBaseUrl?: string | null;
            schema: TailorKitSchemaSpecType;
          };
          metaSnapshot = {
            assetsBaseUrl: meta.assetsBaseUrl ?? null,
            error: null,
            schema: meta.schema,
            status: "ready",
          };
          emit();
        })
        .catch((error: unknown) => {
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
  };
  return {
    ...store,
    previews: createPreviewManager(baseUrl, () => {
      void store.fetchApps({ force: true });
    }),
  };
}

export function toBaseUrl(value: string | URL): URL {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}
