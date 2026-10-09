import {
  createTailorKitClientConfig,
  createComponentRegistry,
  createTailorKitStore,
} from "@tailorkit/client-core";
import type {
  AnyComponentDefinition,
  ComponentRenderer,
  ComponentRenderers,
  CompleteComponentRenderers,
  TailorKitClientConfig,
  TailorKitApp,
  SlotMultiple,
} from "@tailorkit/client-core";
export type { TailorKitClientConfig } from "@tailorkit/client-core";
import type { TailorKitCacheOptions } from "@tailorkit/client-core";
import { createElement, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  TailorKitTheme,
  ComponentDefinition,
  ComponentProps,
  ViewDefinition,
  SlotDefinitions,
  TailorKitContract,
} from "@tailorkit/core/schema";
import type { primitives } from "./primitives";

import { TailorkitContext, useTailorkitContext } from "./components/context";
import { useViewContext as useRootViewContext } from "./hooks/use-view-context";
import type { UseViewContext, ViewName, ViewState } from "./hooks/use-view-context";
import { useApps as useRootApps } from "./hooks/use-apps";
import type { UseAppsOptions, UseAppsResult } from "./hooks/use-apps";
import { useViews as useRootViews } from "./hooks/use-views";
import type { UseViewsOptions, UseViewsResult } from "./hooks/use-views";
import { RenderSlot as ReactRenderSlot } from "./components/render-slot";
import type {
  ControlledRenderSlotProps,
  RenderSlotComponent,
  RenderSlotProps,
} from "./components/render-slot";

export type { TailorKitApp } from "@tailorkit/client-core";

export interface TailorKitProviderProps {
  apps?: TailorKitApp[];
  children?: ReactNode;
}

export interface TailorKitInstance<
  TViews extends Record<string, ViewDefinition> = Record<string, ViewDefinition>,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TScopeNames extends string = string,
> extends TailorKitClientConfig {
  readonly $slots?: TSlots;
  readonly $views?: TViews;
  readonly Provider: (props: TailorKitProviderProps) => ReactNode;
  readonly RenderSlot: RenderSlotComponent<TViews, TSlots>;
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
  _contract: { components: TComponents },
  customComponents: CustomComponentRenderers<TComponents>,
): ComponentRenderers<TComponents, ReactNode> {
  return customComponents as ComponentRenderers<TComponents, ReactNode>;
}

export function createClient<const TContract extends TailorKitContract>(options: {
  contract: TContract;
  baseUrl: string | URL;
  assetsBaseUrl?: string | URL;
  components?: CompleteComponentRenderers<NoInfer<TContract["components"]>, ReactNode>;
  theme?: TailorKitTheme;
  cache?: TailorKitCacheOptions;
  fetch?: typeof fetch;
}): TailorKitInstance<TContract["views"], TContract["slots"], keyof TContract["scopes"] & string> {
  return createReactTailorKitClient<
    TContract["components"],
    TContract["views"],
    TContract["slots"],
    keyof TContract["scopes"] & string
  >(options);
}

function createReactTailorKitClient<
  TComponents extends Record<string, AnyComponentDefinition>,
  TViews extends Record<string, ViewDefinition> = Record<string, never>,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TScopeNames extends string = string,
>(options: {
  contract: TailorKitContract;
  assetsBaseUrl?: string | URL;
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
    Provider: function TailorKitProvider({ children, apps }: TailorKitProviderProps) {
      const [store] = useState(() =>
        createTailorKitStore({
          baseUrl: client.baseUrl,
          contract: client.contract,
          apps,
          client: client.fetchClient,
          assetsBaseUrl: client.assetsBaseUrl,
        }),
      );
      useEffect(() => {
        store.setProvidedApps(apps);
      }, [store, apps]);
      useEffect(() => () => store.previews.dispose(), [store]);
      const context = useMemo(() => ({ store, client }), [store]);
      return createElement(TailorkitContext.Provider, { value: context }, children);
    },
    RenderSlot: Object.assign(
      function ClientRenderSlot(props: RenderSlotProps<TSlots>) {
        useTailorkitContext("RenderSlot", client);
        return createElement(ReactRenderSlot, props as RenderSlotProps);
      },
      {
        Controlled: function ClientControlledRenderSlot(
          props: ControlledRenderSlotProps<TViews, TSlots>,
        ) {
          useTailorkitContext("RenderSlot.Controlled", client);
          return createElement(
            ReactRenderSlot.Controlled,
            props as unknown as ControlledRenderSlotProps,
          );
        },
      },
    ),
    useApps: function useClientApps(options) {
      useTailorkitContext("useApps", client);
      return useRootApps(options);
    },
    useViews: function useClientViews<TSlot extends keyof TSlots & string>(
      options: UseViewsOptions<TScopeNames, TSlot>,
    ) {
      useTailorkitContext("useViews", client);
      return useRootViews(options) as UseViewsResult<SlotMultiple<TSlots[TSlot]>>;
    },
    useViewContext: function useClientViewContext<TView extends ViewName<TViews>>(
      view: TView,
      options: ViewState<TViews, NoInfer<TView>>,
    ) {
      useTailorkitContext("useViewContext", client);
      useRootViewContext<TViews, TView>(view, options);
    },
  };

  return client;
}

export type { ViewOptions } from "./hooks/use-view-context";
