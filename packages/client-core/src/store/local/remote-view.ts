import { atom, batch, computed } from "nanostores";
import { createIframeUiHost } from "@tailorkit/sandbox/host";
import type { IframeUiHost, IframeUiHostOptions } from "@tailorkit/sandbox/host";
import type { HostToIframePayload, RemoteElementNode } from "@tailorkit/sandbox/protocol";
import { NodeStore } from "./node-store";

export interface RemoteViewSnapshot {
  error: Error | null;
  generation: number;
  status: "starting" | "ready" | "error";
}

export interface RemoteViewStoreOptions {
  components?: Record<string, unknown>;
  props?: Record<string, unknown>;
}

export interface RemoteViewMountOptions extends Omit<IframeUiHostOptions, "onError" | "props"> {
  appUrl: string | URL;
}

interface RunningView {
  host: IframeUiHost | null;
  unsubscribe: (() => void) | null;
  stopped: boolean;
}

/** One remote app's state and host lifecycle, independent of its rendering framework. */
export function createRemoteViewStore(
  options: RemoteViewStoreOptions = {},
  createHost: typeof createIframeUiHost = createIframeUiHost,
) {
  const nodes = new NodeStore();
  const components = atom(options.components ?? {});
  const state = atom<RemoteViewSnapshot>({ status: "starting", error: null, generation: 0 });
  let props = options.props;
  let current: RunningView | null = null;

  const stop = (run: RunningView) => {
    if (run.stopped) return;
    run.stopped = true;
    if (current === run) current = null;
    run.unsubscribe?.();
    run.host?.destroy();
  };

  const reset = () => {
    batch(() => {
      nodes.clear();
      state.set({ status: "starting", error: null, generation: state.get().generation });
    });
  };

  return {
    nodes,
    components,
    state,
    selectComponent: (name: string) => computed(components, (registry) => registry[name]),
    setComponents: (registry: Record<string, unknown>) => components.set(registry),
    setProps(next: Record<string, unknown> | undefined) {
      props = next;
      current?.host?.setProps(next);
    },
    dispatch(payload: HostToIframePayload) {
      current?.host?.dispatch(payload);
    },
    mount({ appUrl, ...hostOptions }: RemoteViewMountOptions): () => void {
      if (current) stop(current);
      const generation = state.get().generation + 1;
      batch(() => {
        nodes.clear();
        state.set({ status: "starting", error: null, generation });
      });
      const run: RunningView = { host: null, unsubscribe: null, stopped: false };
      current = run;
      const reportError = (error: Error) => {
        if (current !== run || run.stopped) return;
        console.error("TailorKit remote app failed", error);
        state.set({ status: "error", error, generation });
      };
      try {
        const host = createHost(appUrl, { ...hostOptions, props, onError: reportError });
        run.host = host;
        run.unsubscribe = host.subscribe(() => {
          if (current !== run || run.stopped) return;
          const tree = host.getSnapshot();
          if (tree !== null) {
            batch(() => {
              nodes.setSnapshot(tree);
              const previous = state.get();
              if (previous.status !== "ready") {
                state.set({ status: "ready", error: null, generation });
              }
            });
          }
        });
        host.mount();
      } catch (error) {
        reportError(error instanceof Error ? error : new Error(String(error)));
        stop(run);
      }
      return () => {
        if (current !== run) return;
        stop(run);
        reset();
      };
    },
    destroy() {
      if (current) stop(current);
      reset();
    },
  };
}

export type RemoteViewStore = ReturnType<typeof createRemoteViewStore>;

/** Bind remote callbacks to their protocol payload without framework event arguments leaking. */
export function createRemoteElementProps(
  node: RemoteElementNode,
  dispatch: RemoteViewStore["dispatch"],
): Record<string, unknown> {
  const props: Record<string, unknown> = { ...node.props };
  for (const binding of node.callbacks ?? []) {
    props[binding.callback] = (...args: unknown[]) => {
      dispatch({
        type: "dispatchCallback",
        data: { nodeId: node.id, event: binding.event, args: args.slice(0, binding.inputCount) },
      });
    };
  }
  return props;
}
