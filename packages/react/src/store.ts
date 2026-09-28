import type { TailorKitSchemaSpecType } from "@tailorkit/core/spec";
import type { TailorKitApp } from "./tailor-kit";
import { createViewRegistry } from "./view-registry";
import { createPreviewManager } from "./preview-manager";
import { appendScopeSelection, normalizeScopeSelection } from "./scope-query";

export interface TailorKitAppsSnapshot {
  apps: TailorKitApp[];
  error: Error | null;
  status: "error" | "idle" | "loading" | "ready";
}

interface AppsEntry {
  scopes?: readonly string[];
  snapshot: TailorKitAppsSnapshot;
  promise: Promise<void> | null;
  requestId: number;
  requested: boolean;
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
  const appsEntries = new Map<string, AppsEntry>();
  let metaSnapshot: TailorKitMetaSnapshot = {
    assetsBaseUrl: null,
    error: null,
    schema: null,
    status: "idle",
  };
  let fetchMetaPromise: Promise<void> | null = null;

  const getAppsEntry = (scopes?: readonly string[]): AppsEntry => {
    const selection = normalizeScopeSelection(scopes);
    let entry = appsEntries.get(selection.key);
    if (!entry) {
      entry = {
        scopes: selection.scopes,
        snapshot: {
          apps: providedApps ?? [],
          error: null,
          status: providedApps === undefined ? "idle" : "ready",
        },
        promise: null,
        requestId: 0,
        requested: false,
      };
      appsEntries.set(selection.key, entry);
    }
    return entry;
  };

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
      for (const entry of appsEntries.values()) {
        entry.requestId += 1;
        entry.promise = null;
        entry.snapshot = {
          apps: apps ?? [],
          error: null,
          status: apps === undefined ? "idle" : "ready",
        };
      }
      emit();
      if (apps === undefined) {
        for (const entry of appsEntries.values()) {
          if (entry.requested) {
            void store.fetchApps({ scopes: entry.scopes });
          }
        }
      }
    },
    fetchApps: (options: { force?: boolean; scopes?: readonly string[] } = {}): Promise<void> => {
      const entry = getAppsEntry(options.scopes);
      entry.requested = true;
      if (providedApps !== undefined) {
        return Promise.resolve();
      }
      if (entry.promise && !options.force) {
        return entry.promise;
      }

      entry.snapshot = { ...entry.snapshot, status: "loading" };
      emit();

      const requestId = ++entry.requestId;

      const appsUrl = new URL("apps", baseUrl);
      appendScopeSelection(appsUrl, entry.scopes);
      entry.promise = fetch(appsUrl)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Unable to fetch TailorKit apps from ${baseUrl.toString()}.`);
          }
          const apps = (await response.json()) as TailorKitApp[];
          if (requestId !== entry.requestId) {
            return;
          }
          entry.snapshot = {
            apps,
            error: null,
            status: "ready",
          };
          emit();
        })
        .catch((error: unknown) => {
          if (requestId !== entry.requestId) {
            return;
          }
          entry.snapshot = {
            ...entry.snapshot,
            error: error instanceof Error ? error : new Error(String(error)),
            status: "error",
          };
          emit();
        });

      return entry.promise;
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
    getAppsSnapshot: (scopes?: readonly string[]): TailorKitAppsSnapshot =>
      getAppsEntry(scopes).snapshot,
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
      for (const entry of appsEntries.values()) {
        if (entry.requested) {
          void store.fetchApps({ force: true, scopes: entry.scopes });
        }
      }
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
