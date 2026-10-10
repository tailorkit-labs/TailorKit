import { atom } from "nanostores";
import { getViewDepth, isViewAncestor } from "@tailorkit/core/views";
import type { ActiveView, ViewStatus } from "@tailorkit/core/views";
import type { TailorKitContract } from "@tailorkit/core/schema";
import type { ViewContextRegistration } from "./view-context-types";
import { validateViewContext } from "./view-context-diagnostics";
import type { ViewContextResult } from "./view-context-diagnostics";

export interface ViewEntry {
  id: symbol;
  view: string;
  context: unknown;
  status: ViewStatus;
  order: number;
}

/** Own view state and diagnostics independently of any framework adapter. */
export function createViewContextStore(contract: Pick<TailorKitContract, "views">) {
  const entries = new Map<symbol, ViewEntry>();
  const state = atom<ActiveView | null>(null);
  let nextOrder = 0;
  let scheduled = false;
  const keys = new Map<symbol, string>();
  const diagnostics = new Map<symbol, string>();

  const parsed = new Map<symbol, { context: unknown; status: ViewStatus }>();

  const apply = (entry: ViewEntry, result: ViewContextResult) => {
    if (entries.get(entry.id) !== entry) return;
    if ("value" in result) {
      parsed.set(entry.id, { context: result.value, status: entry.status });
      diagnostics.delete(entry.id);
    } else {
      parsed.set(entry.id, { context: undefined, status: "error" });
      const key = JSON.stringify([entry.view, entry.context, result.message]);
      if (key !== diagnostics.get(entry.id)) {
        diagnostics.set(entry.id, key);
        if (result.details === undefined) console.error(result.message);
        else console.error(result.message, result.details);
      }
    }
    publish();
  };
  const check = (entry: ViewEntry) => {
    const failed = (error: unknown) =>
      apply(entry, {
        message: `TailorKit could not validate context for view "${entry.view}".`,
        details: error,
      });
    try {
      const result = validateViewContext(
        entry,
        contract.views[entry.view as keyof typeof contract.views],
      );
      if ("then" in result) {
        parsed.set(entry.id, { context: undefined, status: "loading" });
        void result.then((value) => apply(entry, value), failed);
      } else {
        apply(entry, result);
      }
    } catch (error) {
      failed(error);
    }
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
              context: parsed.get(entry.id)?.context,
              status: parsed.get(entry.id)?.status ?? entry.status,
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
      const status =
        input.error != null && input.error !== false
          ? "error"
          : input.loading
            ? "loading"
            : "ready";
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
      check(entry);
      publish();
    },
    unregister(id: symbol) {
      if (!entries.delete(id)) return;
      keys.delete(id);
      parsed.delete(id);
      publish();
    },
  };
}
