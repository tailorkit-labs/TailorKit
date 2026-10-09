import { atom } from "nanostores";
import { getViewDepth, isViewAncestor } from "@tailorkit/core/views";
import type { ActiveView, ViewStatus } from "@tailorkit/core/views";
import type { TailorKitFetchClient } from "../../client/fetch-client";
import type { ViewContextRegistration } from "./view-context-types";
import { createViewContextDiagnostics } from "./view-context-diagnostics";

export interface ViewEntry {
  id: symbol;
  view: string;
  context: unknown;
  status: ViewStatus;
  order: number;
}

/** Own view state and diagnostics independently of any framework adapter. */
export function createViewContextStore(client: TailorKitFetchClient) {
  const entries = new Map<symbol, ViewEntry>();
  const state = atom<ActiveView | null>(null);
  let nextOrder = 0;
  let scheduled = false;
  let metadataScheduled = false;
  let stopMetadata: (() => void) | null = null;
  const metadata = client.meta();
  const diagnose = createViewContextDiagnostics();
  const keys = new Map<symbol, string>();
  const diagnostics = new Map<symbol, string>();
  const parsedContexts = new Map<symbol, unknown>();

  const check = (entry: ViewEntry) => {
    const definition = metadata.getSnapshot().data?.schema?.views?.[entry.view];
    const diagnostic = diagnose(entry, definition);
    const context = "value" in diagnostic ? diagnostic.value : entry.context;
    const changed = JSON.stringify(parsedContexts.get(entry.id)) !== JSON.stringify(context);
    if (changed || !parsedContexts.has(entry.id)) parsedContexts.set(entry.id, context);
    if ("value" in diagnostic) {
      diagnostics.delete(entry.id);
      return changed;
    }
    const key = JSON.stringify([entry.view, entry.context, diagnostic.message]);
    if (key !== diagnostics.get(entry.id)) {
      diagnostics.set(entry.id, key);
      if (diagnostic.details === undefined) {
        console.error(diagnostic.message);
      } else {
        console.error(diagnostic.message, diagnostic.details);
      }
    }
    return changed;
  };

  const observeMetadata = () => {
    if (!stopMetadata) {
      stopMetadata = metadata.subscribe(() => {
        let changed = false;
        for (const entry of entries.values()) changed = check(entry) || changed;
        if (changed) publish();
      });
    }
    if (metadataScheduled) return;
    metadataScheduled = true;
    // Let other store consumers start a shared metadata request first.
    queueMicrotask(() => {
      metadataScheduled = false;
      if (entries.size > 0 && metadata.getSnapshot().status === "idle") {
        void metadata.fetch();
      }
    });
  };

  const publish = () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    // Registrations and cleanups in the same turn settle before publication.
    queueMicrotask(() => {
      scheduled = false;
      // Retain diagnostic keys across synchronous cleanup/remount cycles.
      for (const id of diagnostics.keys()) {
        if (!entries.has(id)) diagnostics.delete(id);
      }
      const ordered = [...entries.values()].toSorted(
        (a, b) => getViewDepth(b.view) - getViewDepth(a.view) || b.order - a.order,
      );
      const selected = ordered[0];
      if (selected) {
        const peers = ordered.filter(
          (entry) => getViewDepth(entry.view) === getViewDepth(selected.view),
        );
        if (peers.length > 1) {
          console.warn(
            `TailorKit found multiple active views at the same hierarchy depth: ${peers
              .toReversed()
              .map((entry) => `"${entry.view}"`)
              .join(
                ", ",
              )}. TailorKit selected "${selected.view}" by mount order. Only one route at a hierarchy depth should register a view.`,
          );
        }
        state.set({
          view: selected.view,
          layers: ordered
            .filter((entry) => isViewAncestor(entry.view, selected.view))
            .toReversed()
            .map((entry) => ({
              path: entry.view,
              context: parsedContexts.get(entry.id),
              status: entry.status,
            })),
        });
      } else {
        state.set(null);
      }
    });
  };
  return {
    state,
    getSnapshot: () => state.get(),
    subscribe: (listener: () => void): (() => void) => state.listen(listener),
    register(input: ViewContextRegistration) {
      const status = input.error != null ? "error" : input.loading ? "loading" : "ready";
      const context = status === "ready" ? input.context : undefined;
      const key = JSON.stringify({ view: input.view, context, status });
      if (keys.get(input.id) === key) return;
      const entry: ViewEntry = {
        id: input.id,
        view: input.view,
        context,
        status,
        order: entries.get(input.id)?.order ?? nextOrder++,
      };
      entries.set(input.id, entry);
      keys.set(input.id, key);
      observeMetadata();
      check(entry);
      publish();
    },
    unregister(id: symbol) {
      if (!entries.delete(id)) return;
      keys.delete(id);
      parsedContexts.delete(id);
      if (entries.size === 0) {
        stopMetadata?.();
        stopMetadata = null;
      }
      publish();
    },
  };
}
