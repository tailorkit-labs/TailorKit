import { createTailorKitFetchClient } from "@tailorkit/client-core";
import type { TailorKitFetchClient, TailorKitCacheOptions } from "@tailorkit/client-core";
import { createElement } from "react";
import type { ReactNode } from "react";
import type {
  TailorKitTheme,
  CallbackMap,
  ComponentDefinition,
  ComponentProps,
  Schema,
  ViewDefinition,
  SlotDefinitions,
  TailorKitSchema,
} from "@tailorkit/core/schema";
import type { primitives } from "./primitives";

import { useTailorRootContext } from "./components/context";
import { useRegisterView as useRootRegisterView } from "./hooks/use-register-view";
import type { UseRegisterView, ViewName, ViewState } from "./hooks/use-register-view";
import { useApps as useRootApps } from "./hooks/use-apps";
import type { UseAppsOptions, UseAppsResult } from "./hooks/use-apps";
import { useViews as useRootViews } from "./hooks/use-views";
import type { UseViewsOptions, UseViewsResult } from "./hooks/use-views";
import { useSlotInstances as useRootSlotInstances } from "./hooks/use-slot-instances";
import type { UseSlotInstancesOptions, UseSlotInstancesResult } from "./hooks/use-slot-instances";
import { Slot as ReactSlot } from "./components/slot";
import type { ControlledSlotProps, SlotComponent, SlotProps } from "./components/slot";

type AnyComponentDefinition = ComponentDefinition<
  Schema | undefined,
  CallbackMap,
  boolean | undefined
>;

type ComponentRenderer<TComponent extends AnyComponentDefinition> = (args: {
  props: ComponentProps<TComponent>;
  children?: TComponent extends { children: true } ? ReactNode : never;
}) => ReactNode;

type ComponentRenderers<TComponents extends Record<string, AnyComponentDefinition>> = {
  [TName in keyof TComponents]?: ComponentRenderer<TComponents[TName]>;
};

type CompleteComponentRenderers<TComponents extends Record<string, AnyComponentDefinition>> = {
  [TName in keyof TComponents]-?: ComponentRenderer<TComponents[TName]>;
};

export type { TailorKitApp, TailorKitView } from "@tailorkit/client-core";

const componentTagPrefix = "tailorkit-";

const toComponentTagName = (name: string): string =>
  `${componentTagPrefix}${name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replaceAll(/[\s_]+/gu, "-")
    .toLowerCase()}`;

export interface TailorKitClientConfig {
  readonly baseUrl: string | URL;
  readonly fetchClient?: TailorKitFetchClient;
  readonly components: Record<string, unknown>;
  readonly theme: TailorKitTheme;
}

export interface TailorKitInstance<
  TViews extends Record<string, ViewDefinition> = Record<string, ViewDefinition>,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TScopeNames extends string = string,
> extends TailorKitClientConfig {
  readonly $slots?: TSlots;
  readonly $views?: TViews;
  readonly Slot: SlotComponent<TViews, TSlots>;
  readonly useApps: (options?: UseAppsOptions<TScopeNames>) => UseAppsResult;
  readonly useViews: (
    options?: UseViewsOptions<TScopeNames, keyof TSlots & string>,
  ) => UseViewsResult;
  readonly useSlotInstances: (
    options: UseSlotInstancesOptions<keyof TSlots & string>,
  ) => UseSlotInstancesResult;
  readonly useRegisterView: UseRegisterView<TViews>;
}

type PrimitiveRenderers = typeof primitives;
type CustomComponentRenderers<TComponents extends Record<string, AnyComponentDefinition>> = {
  [TName in Exclude<keyof TComponents, keyof PrimitiveRenderers>]?: ComponentRenderer<
    TComponents[TName]
  >;
};

export function components<TComponents extends Record<string, AnyComponentDefinition>>(
  _schema: TailorKitSchema<TComponents, Record<string, ViewDefinition>>,
  customComponents: CustomComponentRenderers<TComponents>,
): ComponentRenderers<TComponents> {
  return customComponents as ComponentRenderers<TComponents>;
}

interface TailorKitServerShape {
  $internal: {
    schema: {
      components: Record<string, unknown>;
      views: Record<string, unknown>;
    };
  };
}

type ServerComponentMap<TTailor extends TailorKitServerShape> =
  TTailor["$internal"]["schema"]["components"];

type ServerComponents<TTailor extends TailorKitServerShape> = {
  [
    TName in keyof ServerComponentMap<TTailor>
  ]: ServerComponentMap<TTailor>[TName] extends AnyComponentDefinition
    ? ServerComponentMap<TTailor>[TName]
    : never;
};

type ServerViewMap<TTailor extends TailorKitServerShape> = TTailor["$internal"]["schema"]["views"];

type ServerScopeNames<TTailor extends TailorKitServerShape> = TTailor extends {
  handler: (request: Request, options: infer TOptions) => unknown;
}
  ? TOptions extends { authenticate: infer TAuthenticate }
    ? TAuthenticate extends (...args: infer _TArgs) => infer TResult
      ? Extract<Awaited<TResult>, { scopes: unknown }> extends { scopes: infer TScopes }
        ? keyof TScopes & string
        : never
      : never
    : never
  : never;

type ServerViews<TTailor extends TailorKitServerShape> = {
  [TName in keyof ServerViewMap<TTailor>]: ServerViewMap<TTailor>[TName] extends ViewDefinition
    ? ServerViewMap<TTailor>[TName]
    : never;
};

export function createTailorKitClient<TTailor extends TailorKitServerShape>(options: {
  baseUrl: string | URL;
  components?: CompleteComponentRenderers<ServerComponents<TTailor>>;
  theme?: TailorKitTheme;
  cache?: TailorKitCacheOptions;
  fetch?: typeof fetch;
}): TailorKitInstance<
  ServerViews<TTailor>,
  TTailor extends { readonly $slots?: infer V extends SlotDefinitions } ? V : SlotDefinitions,
  ServerScopeNames<TTailor>
> {
  return createReactTailorKitClient<
    ServerComponents<TTailor>,
    ServerViews<TTailor>,
    TTailor extends { readonly $slots?: infer V extends SlotDefinitions } ? V : SlotDefinitions,
    ServerScopeNames<TTailor>
  >(options);
}

function createReactTailorKitClient<
  TComponents extends Record<string, AnyComponentDefinition>,
  TViews extends Record<string, ViewDefinition> = Record<string, never>,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TScopeNames extends string = string,
>(options: {
  baseUrl: string | URL;
  components?: ComponentRenderers<TComponents>;
  theme?: TailorKitTheme;
  cache?: TailorKitCacheOptions;
  fetch?: typeof fetch;
}): TailorKitInstance<TViews, TSlots, TScopeNames> {
  const wrappedComponents: Record<string, unknown> = {};

  const theme = options.theme ?? {};

  for (const [name, renderer] of Object.entries(options.components ?? {})) {
    if (renderer) {
      const TailorKitComponent = function TailorKitComponent({
        children,
        ...props
      }: Record<string, unknown> & { children?: ReactNode }) {
        return (renderer as ComponentRenderer<ComponentDefinition & { children: true }>)({
          props: props as ComponentProps<ComponentDefinition>,
          children,
        });
      };
      wrappedComponents[name] = TailorKitComponent;
      wrappedComponents[toComponentTagName(name)] = TailorKitComponent;
    }
  }

  const clientConfig: TailorKitClientConfig = {
    baseUrl: options.baseUrl,
    fetchClient: createTailorKitFetchClient({
      baseUrl: options.baseUrl,
      cache: options.cache,
      fetch: options.fetch,
    }),
    components: wrappedComponents,
    theme,
  };
  const client: TailorKitInstance<TViews, TSlots, TScopeNames> = {
    ...clientConfig,
    Slot: Object.assign(
      function ClientSlot(props: SlotProps<TSlots>) {
        useTailorRootContext("Slot", client);
        return createElement(ReactSlot, props as SlotProps);
      },
      {
        Controlled: function ClientControlledSlot(props: ControlledSlotProps<TViews, TSlots>) {
          useTailorRootContext("Slot.Controlled", client);
          return createElement(ReactSlot.Controlled, props as unknown as ControlledSlotProps);
        },
      },
    ),
    useApps: function useClientApps(options) {
      useTailorRootContext("useApps", client);
      return useRootApps(options);
    },
    useViews: function useClientViews(options) {
      useTailorRootContext("useViews", client);
      return useRootViews(options);
    },
    useSlotInstances: function useClientSlotInstances(options) {
      useTailorRootContext("useSlotInstances", client);
      return useRootSlotInstances(options);
    },
    useRegisterView: function useClientRegisterView<TView extends ViewName<TViews>>(
      view: TView,
      options: ViewState<TViews, NoInfer<TView>>,
    ) {
      useTailorRootContext("useRegisterView", client);
      useRootRegisterView<TViews, TView>(view, options);
    },
  };

  return client;
}

export type { ViewOptions } from "./hooks/use-register-view";
