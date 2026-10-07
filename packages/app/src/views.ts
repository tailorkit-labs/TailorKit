import { createContext, h, render } from "preact";
import type { ComponentChild, ComponentChildren, ComponentType, VNode } from "preact";
import { useContext } from "preact/hooks";
import type { z } from "zod";
import type { FunctionCalls, Identity } from "./server/functions";

declare const __PREACT_VERSION__: string;

const preactVersion = __PREACT_VERSION__;

// oxlint-disable-next-line typescript-eslint/no-empty-interface, typescript-eslint/no-empty-object-type
export interface TailorKitViews {}

// oxlint-disable-next-line typescript-eslint/no-empty-interface, typescript-eslint/no-empty-object-type
export interface TailorKitSlots {}
// Filled by the generated host bindings using a type-only link to the app server.
// oxlint-disable-next-line typescript-eslint/no-empty-interface, typescript-eslint/no-empty-object-type
export interface TailorKitServerFunctions {}

export interface ViewInstance<TData = unknown> {
  key: string;
  metadata: Record<string, unknown>;
  data: TData;
}

export interface InstanceResolverContext<TPath extends AppViewPath> {
  context: ViewContext<TPath>;
  identity: Identity;
  signal: AbortSignal;
  queries: FunctionCalls<TailorKitServerFunctions, "query">;
}

export interface ViewInstances<TPath extends AppViewPath, TSchema extends z.ZodType> {
  dataSchema: TSchema;
  /** Runs on the app server. Only registered queries are available. */
  resolve: (
    context: InstanceResolverContext<TPath>,
  ) => ViewInstance<z.input<TSchema>>[] | Promise<ViewInstance<z.input<TSchema>>[]>;
}
export type SlotName = keyof TailorKitSlots & string;

export type ViewPath = Extract<keyof TailorKitViews & string, `/${string}`>;
export type AppViewPath = ViewPath;

export type ViewProps<TPath extends ViewPath> = TailorKitViews[TPath] extends object
  ? TailorKitViews[TPath]
  : Record<string, never>;

export type ViewPropsForPath<TPath extends AppViewPath> = TPath extends ViewPath
  ? ViewProps<TPath>
  : never;

export type ViewContext<TPath extends AppViewPath> =
  ViewPropsForPath<TPath> extends { context: infer TContext } ? TContext : Record<string, never>;

export type View<TProps extends object = Record<string, never>> = (props: TProps) => ComponentChild;

export type ViewRuntimeProps<TPath extends AppViewPath, TData = unknown> =
  | {
      context: ViewContext<TPath>;
      view: TPath;
      status: "ready";
      instance?: ViewInstance<TData>;
    }
  | {
      context?: never;
      view: TPath;
      status: "loading";
      instance?: never;
    }
  | {
      context?: never;
      view: TPath;
      status: "error";
      instance?: never;
    };

export interface ViewDefinition<
  TPath extends AppViewPath = AppViewPath,
  TData = unknown,
  TSlot extends SlotName = SlotName,
> {
  component: View<ViewRuntimeProps<TPath>>;
  path: TPath;
  slot: TSlot;
  useContext: () => ViewContext<TPath>;
  /** The selected instance, with data inferred from instances.dataSchema. */
  useInstance: () => ViewInstance<TData>;
  /** Build-only lookup key connecting this view to its extracted server implementation. */
  instances?: { resolver: string };
}

type InvalidViewPath<TViews> = Exclude<keyof TViews & string, AppViewPath>;

type RequireViewPaths<TViews> =
  InvalidViewPath<TViews> extends never
    ? unknown
    : {
        readonly __tailorkit_error__: `View paths must be declared by the host. Invalid view: ${InvalidViewPath<TViews>}`;
      };

type ViewKeyPathMismatch<TViews> = {
  [TPath in keyof TViews & string]: TViews[TPath] extends false
    ? never
    : TViews[TPath] extends ViewDefinition<infer TViewPath>
      ? TViewPath extends TPath
        ? never
        : TPath
      : TPath;
}[keyof TViews & string];

type RequireMatchingViewKeys<TViews> =
  ViewKeyPathMismatch<TViews> extends never
    ? unknown
    : {
        readonly __tailorkit_error__: `View key must match createView path. Invalid view: ${ViewKeyPathMismatch<TViews>}`;
      };

export type SlotView<TSlot extends SlotName> = TailorKitSlots[TSlot] extends { views: infer TViews }
  ? Extract<TViews, AppViewPath>
  : never;
type SlotDefinitions = {
  [V in SlotName]?: Partial<{ [P in SlotView<V>]: ViewDefinition<P, unknown, V> | false }>;
};
type RequireSlotViews<V, S> = V extends SlotName
  ? Exclude<keyof S, SlotView<V>> extends never
    ? unknown
    : { readonly __tailorkit_error__: "View is not supported by this slot" }
  : never;
export interface TailorKitClient<TSlots extends SlotDefinitions = SlotDefinitions> {
  slots: TSlots;
  /** Wrap the app root with providers shared by every view. */
  component?: ComponentType<{ children?: ComponentChildren }>;
}

export interface TailorKitClientMeta {
  preactVersion: string;
}

export interface TailorKitClientRuntime {
  h: typeof h;
  render: (vnode: VNode | null, parent: Element | Document | ShadowRoot | DocumentFragment) => void;
}

export type TailorKitClientWithMeta<TViews extends SlotDefinitions = SlotDefinitions> =
  TailorKitClient<TViews> & {
    $meta: TailorKitClientMeta;
    $runtime: TailorKitClientRuntime;
  };

type ViewOptions<TPath extends AppViewPath, TSlot extends SlotName, TSchema extends z.ZodType> = {
  [S in TSlot]: {
    slot: S;
    component: View<Record<string, never>>;
  } & (TPath extends SlotView<S>
    ? unknown
    : { readonly __tailorkit_error__: "View is not supported by this slot" }) &
    (TailorKitSlots[S] extends { multiple: true }
      ? { instances: ViewInstances<TPath, TSchema> }
      : { instances?: never });
}[TSlot];

export const createView = <
  const TPath extends AppViewPath,
  const TSlot extends SlotName,
  TSchema extends z.ZodType,
>(
  path: TPath,
  options: ViewOptions<TPath, TSlot, TSchema>,
): ViewDefinition<TPath, z.output<TSchema>, TSlot> => {
  const Context = createContext<{ context: ViewContext<TPath>; instance?: ViewInstance } | null>(
    null,
  );
  const instances = options.instances as unknown as { resolver?: string } | undefined;
  if (instances && !instances.resolver) {
    throw new Error("View instance resolvers must be compiled with the TailorKit app build.");
  }

  const View = (props: ViewRuntimeProps<TPath>) => {
    if (props.status !== "ready") {
      return null;
    }

    if (instances && !props.instance) {
      throw new Error(
        `View "${path}" requires a selected instance. Pass instanceKey to Slot or instance to Slot.Controlled.`,
      );
    }
    return h(
      Context.Provider,
      { value: { context: props.context as ViewContext<TPath>, instance: props.instance } },
      h(options.component as ComponentType<object>, { key: props.instance?.key }),
    );
  };

  return {
    component: View,
    path,
    slot: options.slot,
    ...(instances?.resolver ? { instances: { resolver: instances.resolver } } : {}),
    useContext: () => {
      const context = useContext(Context);

      if (context === null) {
        throw new Error(`View context is only available while rendering "${path}".`);
      }

      return context.context;
    },
    useInstance: () => {
      const value = useContext(Context);
      if (!value?.instance)
        throw new Error(
          `View instance is only available while rendering an instance of "${path}".`,
        );
      return value.instance as ViewInstance<z.output<TSchema>>;
    },
  };
};

export const defineClient = <const TSlots extends SlotDefinitions>(
  client: TailorKitClient<TSlots> & {
    slots: {
      [V in keyof TSlots]: TSlots[V] &
        RequireViewPaths<TSlots[V]> &
        RequireMatchingViewKeys<TSlots[V]> &
        RequireSlotViews<V, TSlots[V]>;
    };
  } & (Exclude<keyof TSlots, SlotName> extends never
      ? unknown
      : { __tailorkit_error__: "Unknown slot" }),
): TailorKitClientWithMeta<TSlots> => {
  for (const [slot, views] of Object.entries(client.slots)) {
    for (const [path, view] of Object.entries(views ?? {})) {
      if (view !== false && view.slot !== slot)
        throw new Error(`View "${path}" was created for slot "${view.slot}", not "${slot}".`);
    }
  }
  return {
    ...client,
    $meta: { preactVersion },
    $runtime: {
      h,
      render: (vnode, parent) =>
        render(
          vnode && client.component ? h(client.component, { children: vnode }) : vnode,
          parent,
        ),
    },
  };
};

const componentTagPrefix = "tailorkit-";

const toComponentTagName = (name: string): string =>
  `${componentTagPrefix}${name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replaceAll(/[\s_]+/gu, "-")
    .toLowerCase()}`;

const toCallbackEventName = (name: string): string =>
  `tailorkitcallback${name.replaceAll(/[^A-Za-z0-9_$]/gu, "").toLowerCase()}`;

const toEventProp = (event: string): string => `on${event}`;

export const createRemoteComponent = <TProps extends object, TChildren extends boolean = false>(
  name: string,
  options: { callbacks?: Record<string, number>; children?: TChildren } = {},
): View<TProps & { children?: TChildren extends true ? ComponentChildren : never }> => {
  const tagName = toComponentTagName(name);
  const callbacks = options.callbacks ?? {};

  return function RemoteComponent({ children, ...props }) {
    const nextProps = { ...props } as Record<string, unknown>;
    const callbackMap: Record<string, { callback: string; inputCount: number }> = {};

    for (const [key, inputCount] of Object.entries(callbacks)) {
      const callback = nextProps[key];
      Reflect.deleteProperty(nextProps, key);
      if (typeof callback !== "function") {
        continue;
      }

      const eventName = toCallbackEventName(key);
      callbackMap[eventName] = { callback: key, inputCount };
      nextProps[toEventProp(eventName)] = (event: { detail?: unknown[] }) => {
        callback(...(event.detail ?? []).slice(0, inputCount));
      };
    }

    const serializedProps = Object.fromEntries(
      Object.entries(nextProps).filter(([, value]) => typeof value !== "function"),
    );
    nextProps["data-tailorkit-props"] = JSON.stringify(serializedProps);

    if (Object.keys(callbackMap).length > 0) {
      nextProps["data-tailorkit-callbacks"] = JSON.stringify(callbackMap);
    }

    return h(tagName, nextProps, options.children ? children : undefined);
  };
};
