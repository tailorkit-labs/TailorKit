import { atom } from "nanostores";
import { getViewDepth, isViewAncestor } from "@tailorkit/core/views";
import type { ActiveView, ViewStatus } from "@tailorkit/core/views";

export interface ViewEntry {
  id: symbol;
  view: string;
  context: unknown;
  status: ViewStatus;
  order: number;
}

export function createViewRegistry() {
  const entries = new Map<symbol, ViewEntry>();
  const state = atom<ActiveView | null>(null);
  let nextOrder = 0;
  let scheduled = false;

  const publish = () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    // Registrations and cleanups in the same turn settle before publication.
    queueMicrotask(() => {
      scheduled = false;
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
            .map((entry) => ({ path: entry.view, context: entry.context, status: entry.status })),
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
    register(entry: Omit<ViewEntry, "order">) {
      entries.set(entry.id, { ...entry, order: entries.get(entry.id)?.order ?? nextOrder++ });
      publish();
    },
    unregister(id: symbol) {
      entries.delete(id);
      publish();
    },
  };
}
