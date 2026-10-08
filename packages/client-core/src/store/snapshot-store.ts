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
