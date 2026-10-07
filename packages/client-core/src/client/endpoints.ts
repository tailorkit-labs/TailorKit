import { createClient, createSessionProvider, reference } from "@tailorkit/app/client";
import type { ViewInstance } from "@tailorkit/app/client";
import { previewMetadataSchema } from "@tailorkit/client-platform/preview";
import type { TailorKitSchemaSpecType } from "@tailorkit/core/spec";
import type { TailorKitApp } from "../types";
import { toBaseUrl } from "./url";

export interface TailorKitMetadata {
  assetsBaseUrl: string | null;
  schema: TailorKitSchemaSpecType;
}

export interface SlotInstancesInput {
  slot: string;
  path: string;
  context: Record<string, unknown>;
}

const resolveInstances = reference<"action", SlotInstancesInput, ViewInstance[]>(
  "_tailorkit.instances.resolve",
  "action",
);

/** Endpoint transport owns no response stores. */
export function createEndpointClient(options: { baseUrl: string | URL; fetch?: typeof fetch }) {
  const baseUrl = toBaseUrl(options.baseUrl);
  const request: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);
  const sessions = new Map<string, ReturnType<typeof createSessionProvider>>();
  const getSessionProvider = (app: TailorKitApp) => {
    const key = JSON.stringify([app.id, app.currentDeployment?.id, app.preview?.sessionId]);
    let provider = sessions.get(key);
    if (!provider) {
      provider = createSessionProvider({ baseUrl, appId: app.id, fetch: request });
      sessions.set(key, provider);
    }
    return provider;
  };
  return {
    baseUrl,
    async apps(signal: AbortSignal): Promise<TailorKitApp[]> {
      const response = await request(new URL("apps", baseUrl), {
        signal,
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error(`Unable to fetch TailorKit apps from ${baseUrl.toString()}.`);
      return (await response.json()) as TailorKitApp[];
    },
    async meta(signal: AbortSignal): Promise<TailorKitMetadata> {
      const response = await request(new URL("meta", baseUrl), {
        signal,
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error(`Unable to fetch TailorKit metadata from ${baseUrl.toString()}.`);
      const value = (await response.json()) as TailorKitMetadata;
      return { ...value, assetsBaseUrl: value.assetsBaseUrl ?? null };
    },
    async slotInstances(app: TailorKitApp, input: SlotInstancesInput, signal: AbortSignal) {
      signal.throwIfAborted();
      const backend = createClient({ getSession: getSessionProvider(app), fetch: request });
      const abort = () => backend.close();
      signal.addEventListener("abort", abort, { once: true });
      try {
        return await backend.action(resolveInstances, input);
      } finally {
        signal.removeEventListener("abort", abort);
        backend.close();
      }
    },
    async previewMetadata(sessionId: string): Promise<NonNullable<TailorKitApp["preview"]> | null> {
      const url = new URL("preview/metadata", baseUrl);
      url.searchParams.set("sessionId", sessionId);
      const response = await request(url, { credentials: "same-origin" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Unable to refresh TailorKit preview metadata.");
      return previewMetadataSchema.parse(await response.json());
    },
    getSessionProvider,
    clearSessions: () => sessions.clear(),
  };
}

export type EndpointClient = ReturnType<typeof createEndpointClient>;
