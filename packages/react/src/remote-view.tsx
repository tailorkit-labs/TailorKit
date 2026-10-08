import { useStore } from "@nanostores/react";
import type { Session } from "@tailorkit/app/client";
/* oxlint-disable react(invariant) */

import {
  Component,
  Fragment,
  createElement,
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
} from "react";
import type { ReactNode } from "react";
import type { RemoteElementNode } from "@tailorkit/sandbox/protocol";
import { createRemoteViewStore, createRemoteElementProps } from "@tailorkit/client-core";
import type { RemoteViewStore } from "@tailorkit/client-core";

const RemoteUIContext = createContext<RemoteViewStore | null>(null);

const formatError = (error: Error): string => error.message;

interface RemoteErrorBoundaryProps {
  children?: ReactNode;
}

interface RemoteErrorBoundaryState {
  error: Error | null;
}

class RemoteErrorBoundary extends Component<RemoteErrorBoundaryProps, RemoteErrorBoundaryState> {
  state: RemoteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RemoteErrorBoundaryState {
    return { error };
  }

  static componentDidCatch(error: Error): void {
    console.error("TailorKit remote app failed", error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return createElement("div", null, formatError(this.state.error));
    }

    return this.props.children;
  }
}

interface RemoteViewHostProps {
  appUrl: string | URL;
  sourceText?: string;
  getBackendSession?: (options: { refresh: boolean }) => Promise<Session>;
  components: Record<string, unknown>;
  createIframe?: () => HTMLIFrameElement;
  props?: Record<string, unknown>;
}

export function RemoteViewHost({
  appUrl,
  sourceText,
  getBackendSession,
  components,
  createIframe,
  props,
}: RemoteViewHostProps): ReactNode {
  const appKey = appUrl.toString();
  const store = useMemo(() => createRemoteViewStore({ components, props }), [appKey]);
  const snapshot = useStore(store.state);

  useEffect(() => {
    store.setComponents(components);
  }, [components, store]);

  useEffect(() => {
    store.setProps(props);
  }, [props, store]);

  useEffect(
    () => store.mount({ appUrl, sourceText, getBackendSession, createIframe }),
    [appUrl, sourceText, getBackendSession, createIframe, store],
  );

  if (snapshot.status === "error" && snapshot.error) {
    return createElement("div", null, formatError(snapshot.error));
  }

  return (
    <RemoteUIContext.Provider value={store}>
      <RemoteErrorBoundary key={`${appKey}:${snapshot.generation}`}>
        <RemoteRoot store={store} />
      </RemoteErrorBoundary>
    </RemoteUIContext.Provider>
  );
}

function RemoteRoot({ store }: { store: RemoteViewStore }): ReactNode {
  const rootId = useStore(store.nodes.root);
  return rootId === null ? null : <RemoteView nodeId={rootId} />;
}

interface RemoteElementViewProps {
  ctx: RemoteViewStore;
  node: RemoteElementNode;
}

const RemoteElementView = memo(({ ctx, node }: RemoteElementViewProps): ReactNode => {
  const componentStore = useMemo(() => ctx.selectComponent(node.type), [ctx, node.type]);
  const component = useStore(componentStore);
  const children = node.children.map((child) => <RemoteView key={child.id} nodeId={child.id} />);

  if (component === undefined) {
    throw new Error(`TailorKit component "${node.type}" is not registered.`);
  }
  const props = createRemoteElementProps(node, ctx.dispatch);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createElement(component as any, props, ...children);
});

interface RemoteViewProps {
  nodeId: string;
}

function RemoteViewComponent({ nodeId }: RemoteViewProps): ReactNode {
  const ctx = useContext(RemoteUIContext);
  return ctx === null ? null : <RemoteNodeView ctx={ctx} nodeId={nodeId} />;
}

function RemoteNodeView({ ctx, nodeId }: RemoteViewProps & { ctx: RemoteViewStore }): ReactNode {
  const nodeStore = useMemo(() => ctx.nodes.selectNode(nodeId), [ctx, nodeId]);
  const node = useStore(nodeStore);
  if (node === null) {
    return null;
  }

  if (node.kind === "text") {
    return node.text as unknown as ReactNode;
  }

  const childElements = node.children.map((child) => (
    <RemoteView key={child.id} nodeId={child.id} />
  ));

  if (node.kind === "fragment") {
    return createElement(Fragment, { key: node.id }, ...childElements);
  }

  return <RemoteElementView node={node} ctx={ctx} />;
}

export const RemoteView = memo(RemoteViewComponent);
