import { flattenTools } from "@tailorkit/core/schema";
import type {
  TailorKitTheme,
  CallbackMap,
  ComponentDefinition,
  ComponentProps,
  Schema,
  TailorKitContract,
  ToolImplementations,
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
  readonly tools?: ToolImplementations<TailorKitContract["tools"], "client">;
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
  tools?: ToolImplementations<TailorKitContract["tools"], "client">;
  assetsBaseUrl?: string | URL;
  baseUrl: string | URL;
  components?: Record<string, unknown>;
  theme?: TailorKitTheme;
  cache?: TailorKitCacheOptions;
  fetch?: typeof fetch;
}): TailorKitClientConfig {
  const declarations = flattenTools(options.contract.tools);
  const visit = (tree: unknown, prefix = "") => {
    if (!tree || typeof tree !== "object") return;
    for (const [name, value] of Object.entries(tree)) {
      const path = prefix + name;
      if (typeof value === "function") {
        if (declarations.get(path)?.kind !== "client")
          throw new Error(`Undeclared client tool "${path}"`);
      } else visit(value, path + ".");
    }
  };
  visit(options.tools);
  for (const [path, leaf] of declarations) {
    if (leaf.kind !== "client") continue;
    let value: unknown = options.tools;
    for (const name of path.split("."))
      value =
        value && typeof value === "object" && Object.hasOwn(value, name)
          ? (value as Record<string, unknown>)[name]
          : undefined;
    if (typeof value !== "function") throw new Error(`Missing client tool "${path}"`);
  }
  return {
    tools: options.tools,
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
