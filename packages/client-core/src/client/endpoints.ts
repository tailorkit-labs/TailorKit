import type { TailorKitContract, ToolImplementations } from "@tailorkit/core/schema";
import { flattenTools, validateToolValue } from "@tailorkit/core/schema";
import type { ToolBridge } from "@tailorkit/app/client";
import { createClient, createSessionProvider, reference } from "@tailorkit/app/client/connection";
import type { ViewInstance } from "@tailorkit/app/client";
import { previewMetadataSchema } from "@tailorkit/client-platform/preview";
import type { TailorKitApp } from "../types";
import { toBaseUrl } from "./url";

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
export function createEndpointClient(options: {
  baseUrl: string | URL;
  fetch?: typeof fetch;
  contract?: TailorKitContract;
  tools?: ToolImplementations<TailorKitContract["tools"], "client">;
}) {
  const baseUrl = toBaseUrl(options.baseUrl);
  const request: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);
  type SessionProvider = ReturnType<typeof createSessionProvider>;
  interface SessionEntry {
    key: string | undefined;
    session: SessionProvider | undefined;
    provider: SessionProvider;
  }
  let subjectId: string | undefined;
  let generation = 0;
  const toolBridges = new Map<string, { bridge: ToolBridge; app: TailorKitApp }>();
  const declarations = flattenTools(options.contract?.tools ?? {});
  const sessions = new Map<string, SessionEntry>();
  const clearSessions = () => {
    generation++;
    for (const entry of sessions.values()) entry.session = undefined;
    sessions.clear();
  };
  const createSessionEntry = (appId: string, key?: string): SessionEntry => ({
    key,
    session: createSessionProvider({ baseUrl, appId, subjectId, fetch: request }),
    // Mounted consumers keep this wrapper, so resolve the current provider on every call.
    provider: async (input) => {
      let current = sessions.get(appId);
      if (!current) {
        current = createSessionEntry(appId);
        sessions.set(appId, current);
      }
      const session = current.session!;
      const value = await session(input);
      if (current.session !== session) {
        throw new DOMException("The app session was invalidated", "AbortError");
      }
      return value;
    },
  });
  const getSessionProvider = (app: TailorKitApp) => {
    const key = JSON.stringify([app.currentDeployment?.id, app.preview?.sessionId]);
    let entry = sessions.get(app.id);
    if (entry && entry.key === undefined) entry.key = key;
    if (!entry || entry.key !== key) {
      if (entry) entry.session = undefined;
      entry = createSessionEntry(app.id, key);
      sessions.set(app.id, entry);
    }
    return entry.provider;
  };
  const getToolBridge = (app: TailorKitApp): ToolBridge => {
    const existing = toolBridges.get(app.id);
    if (existing) {
      existing.app = app;
      return existing.bridge;
    }
    const session = async (path: string) => {
      const admitted = generation;
      if (!declarations.has(path)) throw new Error("Tool not declared");
      const result = await getSessionProvider(toolBridges.get(app.id)?.app ?? app)({
        refresh: false,
      });
      if (admitted !== generation) throw new Error("Tool identity changed");
      if (
        typeof result.token !== "string" ||
        typeof result.toolUrl !== "string" ||
        !Number.isFinite(result.expiresAt) ||
        result.expiresAt <= Date.now() ||
        result.identity?.installationId !== app.id ||
        (subjectId !== undefined && result.identity.subjectId !== subjectId)
      )
        throw new Error("Invalid tool session");
      return { ...result, identity: result.identity, url: result.toolUrl };
    };
    const bridge: ToolBridge = {
      session: (path) => {
        if (declarations.get(path)?.kind !== "server")
          return Promise.reject(new Error("Not a server tool"));
        return session(path);
      },
      async client(path, input) {
        const admitted = generation;
        const leaf = declarations.get(path);
        if (leaf?.kind !== "client") throw new Error("Not a client tool");
        let implementation: unknown = options.tools;
        for (const part of path.split(".")) {
          if (
            !implementation ||
            typeof implementation !== "object" ||
            !Object.hasOwn(implementation, part)
          )
            throw new Error("Missing client tool");
          implementation = (implementation as Record<string, unknown>)[part];
        }
        if (typeof implementation !== "function") throw new Error("Missing client tool");
        const value = await validateToolValue(leaf.definition.input, input);
        const credential = await session(path);
        const output = await implementation({
          input: value,
          context: Object.freeze({
            identity: credential.identity,
            scope: credential.identity.scope,
            requestId: crypto.randomUUID(),
          }),
        });
        const result = await validateToolValue(leaf.definition.output, output);
        if (admitted !== generation) throw new Error("Tool identity changed");
        return result;
      },
    };
    toolBridges.set(app.id, { bridge, app });
    return bridge;
  };
  return {
    baseUrl,
    getToolBridge,
    setSubject(next?: string) {
      if (subjectId === next) return;
      subjectId = next;
      clearSessions();
    },
    async apps(signal: AbortSignal): Promise<TailorKitApp[]> {
      const response = await request(new URL("apps", baseUrl), {
        signal,
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error(`Unable to fetch TailorKit apps from ${baseUrl.toString()}.`);
      return (await response.json()) as TailorKitApp[];
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
    clearSessions,
  };
}

export type EndpointClient = ReturnType<typeof createEndpointClient>;
