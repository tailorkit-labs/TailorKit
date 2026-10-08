import type { ReadableAtom } from "nanostores";
import { atom, onStart, onStop, readonlyType } from "nanostores";

/** Expose cache snapshots as a Nano Store with immediate observer cleanup. */
export function createSnapshotStore<T>(
  getSnapshot: () => T,
  subscribe: (listener: () => void) => () => void,
) {
  const state = atom(getSnapshot());
  let stop: (() => void) | undefined;
  const sync = () => state.set(getSnapshot());
  state.get = () => {
    sync();
    return state.value;
  };
  onStart(state, () => {
    stop = subscribe(sync);
    sync();
  });
  onStop(state, () => {
    stop?.();
    stop = undefined;
  });
  return readonlyType(state);
}

/** Follow a selected store and detach the previous reader immediately. */
export function switchStore<T>(selection: ReadableAtom<ReadableAtom<T>>) {
  return createSnapshotStore(
    () => selection.get().get(),
    (listener) => {
      let current = selection.get();
      let stopCurrent = current.listen(listener);
      const stopSelection = selection.listen(() => {
        const next = selection.get();
        if (next !== current) {
          const previousStop = stopCurrent;
          current = next;
          stopCurrent = next.listen(listener);
          previousStop();
        }
        listener();
      });
      return () => {
        stopSelection();
        stopCurrent();
      };
    },
  );
}
