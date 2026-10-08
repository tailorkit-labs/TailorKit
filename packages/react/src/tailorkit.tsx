import { createTailorKitClientConfig, createComponentRegistry } from "@tailorkit/client-core";
import type {
  AnyComponentDefinition,
  ComponentRenderer,
  ComponentRenderers,
  CompleteComponentRenderers,
  TailorKitClientConfig,
  TailorKitServerShape,
  ServerComponents,
  ServerViews,
  ServerSlots,
  ServerScopeNames,
  SlotMultiple,
} from "@tailorkit/client-core";
export type { TailorKitClientConfig } from "@tailorkit/client-core";
import type { TailorKitCacheOptions } from "@tailorkit/client-core";
import { createElement } from "react";
import type { ReactNode } from "react";
import type {
  TailorKitTheme,
  ComponentDefinition,
  ComponentProps,
  ViewDefinition,
  SlotDefinitions,
  TailorKitSchema,
} from "@tailorkit/core/schema";
import type { primitives } from "./primitives";

import { useTailorRootContext } from "./components/context";
import { useViewContext as useRootViewContext } from "./hooks/use-view-context";
import type { UseViewContext, ViewName, ViewState } from "./hooks/use-view-context";
import { useApps as useRootApps } from "./hooks/use-apps";
import type { UseAppsOptions, UseAppsResult } from "./hooks/use-apps";
import { useViews as useRootViews } from "./hooks/use-views";
import type { UseViewsOptions, UseViewsResult } from "./hooks/use-views";
import { Slot as ReactSlot } from "./components/slot";
import type { ControlledSlotProps, SlotComponent, SlotProps } from "./components/slot";

export type { TailorKitApp } from "@tailorkit/client-core";

export interface TailorKitInstance<
  TViews extends Record<string, ViewDefinition> = Record<string, ViewDefinition>,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TScopeNames extends string = string,
> extends TailorKitClientConfig {
  readonly $slots?: TSlots;
  readonly $views?: TViews;
  readonly Slot: SlotComponent<TViews, TSlots>;
  readonly useApps: (options?: UseAppsOptions<TScopeNames>) => UseAppsResult;
  readonly useViews: <TSlot extends keyof TSlots & string>(
    options: UseViewsOptions<TScopeNames, TSlot>,
  ) => UseViewsResult<SlotMultiple<TSlots[TSlot]>>;
  readonly useViewContext: UseViewContext<TViews>;
}

type PrimitiveRenderers = typeof primitives;
type CustomComponentRenderers<TComponents extends Record<string, AnyComponentDefinition>> = {
  [TName in Exclude<keyof TComponents, keyof PrimitiveRenderers>]?: ComponentRenderer<
    TComponents[TName],
    ReactNode
  >;
};

export function components<TComponents extends Record<string, AnyComponentDefinition>>(
  _schema: TailorKitSchema<TComponents, Record<string, ViewDefinition>>,
  customComponents: CustomComponentRenderers<TComponents>,
): ComponentRenderers<TComponents, ReactNode> {
  return customComponents as ComponentRenderers<TComponents, ReactNode>;
}

export function createTailorKitClient<TTailor extends TailorKitServerShape>(options: {
  baseUrl: string | URL;
  components?: CompleteComponentRenderers<ServerComponents<TTailor>, ReactNode>;
  theme?: TailorKitTheme;
  cache?: TailorKitCacheOptions;
  fetch?: typeof fetch;
}): TailorKitInstance<ServerViews<TTailor>, ServerSlots<TTailor>, ServerScopeNames<TTailor>> {
  return createReactTailorKitClient<
    ServerComponents<TTailor>,
    ServerViews<TTailor>,
    ServerSlots<TTailor>,
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
  components?: ComponentRenderers<TComponents, ReactNode>;
  theme?: TailorKitTheme;
  cache?: TailorKitCacheOptions;
  fetch?: typeof fetch;
}): TailorKitInstance<TViews, TSlots, TScopeNames> {
  const wrappedComponents = createComponentRegistry(options.components ?? {}, (renderer) => {
    return function TailorKitComponent({
      children,
      ...props
    }: Record<string, unknown> & { children?: ReactNode }) {
      return (renderer as ComponentRenderer<ComponentDefinition & { children: true }, ReactNode>)({
        props: props as ComponentProps<ComponentDefinition>,
        children,
      });
    };
  });
  const clientConfig = createTailorKitClientConfig({ ...options, components: wrappedComponents });
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
    useViews: function useClientViews<TSlot extends keyof TSlots & string>(
      options: UseViewsOptions<TScopeNames, TSlot>,
    ) {
      useTailorRootContext("useViews", client);
      return useRootViews(options) as UseViewsResult<SlotMultiple<TSlots[TSlot]>>;
    },
    useViewContext: function useClientViewContext<TView extends ViewName<TViews>>(
      view: TView,
      options: ViewState<TViews, NoInfer<TView>>,
    ) {
      useTailorRootContext("useViewContext", client);
      useRootViewContext<TViews, TView>(view, options);
    },
  };

  return client;
}

export type { ViewOptions } from "./hooks/use-view-context";
