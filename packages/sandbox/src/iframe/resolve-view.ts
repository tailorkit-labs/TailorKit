import { composeViewContext, getViewHierarchy } from "@tailorkit/core/views";
import type { ActiveView, ResolvedViewProps as ContextProps } from "@tailorkit/core/views";
import type { ViewInstance } from "@tailorkit/app/client";
export type ResolvedViewProps =
  | (Extract<ContextProps, { status: "ready" }> & { instance?: ViewInstance })
  | (Extract<ContextProps, { status: "loading" | "error" }> & { instance?: never });

interface ViewRequestMetadata {
  slot: string;
  declaredViews: readonly string[];
  supportedViews: readonly string[];
  instance?: ViewInstance;
}

type LayeredViewRequest = ViewRequestMetadata & ActiveView & { controlled?: false };
export type ViewRequest =
  | LayeredViewRequest
  | (ViewRequestMetadata & ResolvedViewProps & { controlled: true });

export interface AppViewDefinition {
  instances?: { resolver: string };
  component: (props: ResolvedViewProps) => unknown;
}

export interface AppClient {
  slots: Record<string, Record<string, AppViewDefinition | false>>;
  $runtime: {
    h: (component: AppViewDefinition["component"], props: ResolvedViewProps) => unknown;
    render: (node: unknown, root: Element) => void;
  };
}

export function resolveView(client: AppClient, request: ViewRequest) {
  const views = client.slots[request.slot];
  const selected =
    views &&
    (request.controlled ? [request.view] : getViewHierarchy(request.view)).find(
      (path) => request.supportedViews.includes(path) && Object.hasOwn(views, path),
    );
  if (!selected || views[selected] === false) {
    return null;
  }
  const definition = views[selected];
  if (!definition || typeof definition.component !== "function") {
    throw new TypeError(`TailorKit app client view "${selected}" is missing a component.`);
  }

  const props = request.controlled
    ? controlledViewProps(request)
    : composeViewContext(selected, request);
  if (props.status !== "ready") return { component: definition.component, props };
  if (definition.instances && !request.instance)
    throw new Error(`View "${selected}" requires a selected instance.`);
  if (request.instance !== undefined) {
    if (!definition.instances) throw new Error(`View "${selected}" does not support instances.`);
    const instance = request.instance;
    if (
      !instance ||
      typeof instance !== "object" ||
      typeof instance.key !== "string" ||
      !instance.key ||
      !instance.metadata ||
      typeof instance.metadata !== "object" ||
      Array.isArray(instance.metadata)
    ) {
      throw new TypeError(`Invalid instance for view "${selected}".`);
    }
    return { component: definition.component, props: { ...props, instance } };
  }
  return { component: definition.component, props };
}

function controlledViewProps(
  request: Extract<ViewRequest, { controlled: true }>,
): ResolvedViewProps {
  if (request.status !== "ready") {
    return { view: request.view, status: request.status, context: undefined };
  }
  if (
    request.context === null ||
    typeof request.context !== "object" ||
    Array.isArray(request.context)
  ) {
    return { view: request.view, status: "error", context: undefined };
  }
  return { view: request.view, status: "ready", context: request.context };
}

export function renderClient(client: AppClient, request: ViewRequest, root: Element): void {
  const selected = resolveView(client, request);
  client.$runtime.render(
    selected ? client.$runtime.h(selected.component, selected.props) : null,
    root,
  );
}

export function assertAppClient(value: unknown): asserts value is AppClient {
  const client = value as Partial<AppClient> | null | undefined;
  if (
    !client?.slots ||
    !client.$runtime ||
    typeof client.$runtime.h !== "function" ||
    typeof client.$runtime.render !== "function"
  ) {
    throw new TypeError(
      "TailorKit app must default-export a defineClient() client with slots and its bundled runtime.",
    );
  }
}
