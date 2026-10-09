import type {
  TailorKitTheme,
  CallbackMap,
  ComponentDefinition,
  ComponentProps,
  Schema,
  TailorKitContract,
} from "@tailorkit/core/schema";
import { createTailorKitFetchClient } from "./fetch-client";
import type { TailorKitFetchClient, TailorKitCacheOptions } from "./fetch-client";

export type AnyComponentDefinition = ComponentDefinition<
  Schema | undefined,
  CallbackMap,
  boolean | undefined
>;

export type ComponentRenderer<TComponent extends AnyComponentDefinition, TNode> = (args: {
  props: ComponentProps<TComponent>;
  children?: TComponent extends { children: true } ? TNode : never;
}) => TNode;

export type ComponentRenderers<
  TComponents extends Record<string, AnyComponentDefinition>,
  TNode,
> = {
  [TName in keyof TComponents]?: ComponentRenderer<TComponents[TName], TNode>;
};

export type CompleteComponentRenderers<
  TComponents extends Record<string, AnyComponentDefinition>,
  TNode,
> = {
  [TName in keyof TComponents]-?: ComponentRenderer<TComponents[TName], TNode>;
};

const componentTagPrefix = "tailorkit-";

export const toComponentTagName = (name: string): string =>
  `${componentTagPrefix}${name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replaceAll(/[\s_]+/gu, "-")
    .toLowerCase()}`;

export interface TailorKitClientConfig {
  readonly baseUrl: string | URL;
  readonly contract: TailorKitContract;
  readonly assetsBaseUrl?: string | URL;
  readonly fetchClient?: TailorKitFetchClient;
  readonly components: Record<string, unknown>;
  readonly theme: TailorKitTheme;
}

export type SlotMultiple<TSlot> = TSlot extends { multiple: infer TMultiple extends boolean }
  ? TMultiple
  : TSlot extends { multiple?: infer TMultiple extends boolean }
    ? TMultiple | false
    : false;

/** Build framework-independent client configuration after an adapter wraps its renderers. */
export function createTailorKitClientConfig(options: {
  contract: TailorKitContract;
  assetsBaseUrl?: string | URL;
  baseUrl: string | URL;
  components?: Record<string, unknown>;
  theme?: TailorKitTheme;
  cache?: TailorKitCacheOptions;
  fetch?: typeof fetch;
}): TailorKitClientConfig {
  return {
    baseUrl: options.baseUrl,
    contract: options.contract,
    assetsBaseUrl: options.assetsBaseUrl,
    fetchClient: createTailorKitFetchClient(options),
    components: options.components ?? {},
    theme: options.theme ?? {},
  };
}

/** Register schema names and their remote element aliases with the same wrapped renderer. */
export function createComponentRegistry<T extends Record<string, unknown>, TRenderer>(
  renderers: T,
  wrap: (renderer: NonNullable<T[keyof T]>) => TRenderer,
): Record<string, TRenderer> {
  const components: Record<string, TRenderer> = {};
  for (const [name, renderer] of Object.entries(renderers)) {
    if (renderer) {
      const component = wrap(renderer as NonNullable<T[keyof T]>);
      components[name] = component;
      components[toComponentTagName(name)] = component;
    }
  }
  return components;
}
