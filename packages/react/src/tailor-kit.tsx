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

import type { ViewOptions, ViewName } from "./hooks/use-view";

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

export interface TailorKitApp {
  clientPath?: string;
  description?: string;
  id: string;
  logoPaths?: {
    dark?: string;
    light?: string;
  };
  projectId?: string;
  currentDeployment?: {
    id: string;
  } | null;
  name?: string;
  preview?: { sessionId: string; expiresAt: string; websocketUrl: string; token: string };
}

interface AppViewBaseProps {
  app: TailorKitApp;
  createIframe?: () => HTMLIFrameElement;
  fallback?: ReactNode;
}

type AppViewViewProps<
  TViews extends Record<string, ViewDefinition>,
  TView extends ViewName<TViews> = ViewName<TViews>,
> = [ViewName<TViews>] extends [never]
  ? {
      context?: never;
      view?: never;
      status?: never;
    }
  :
      | {
          context?: never;
          view?: never;
          status?: never;
        }
      | ViewOptions<TViews, TView>;

export type AppViewProps<
  TViews extends Record<string, ViewDefinition> = RegisteredViews,
  TView extends ViewName<TViews> = ViewName<TViews>,
> = {
  [V in RegisteredSlots]: AppViewBaseProps & { slot: V } & AppViewViewProps<
      TViews,
      Extract<TView, SlotView<V>>
    >;
}[RegisteredSlots];

const componentTagPrefix = "tailorkit-";

const toComponentTagName = (name: string): string =>
  `${componentTagPrefix}${name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replaceAll(/[\s_]+/gu, "-")
    .toLowerCase()}`;

// Augment Register once in the host to type the context-based hooks.
// oxlint-disable-next-line typescript-eslint/no-empty-interface, typescript-eslint/no-empty-object-type
export interface Register {}
export type RegisteredViews = Register extends { client: TailorKitInstance<infer S> }
  ? S
  : Record<`/${string}`, ViewDefinition>;
export type RegisteredScopeNames = Register extends { client: { readonly $scopeNames?: infer S } }
  ? Extract<S, string>
  : string;
type RegisteredSlotMap = Register extends { client: { readonly $slots?: infer V } }
  ? V
  : SlotDefinitions;
export type RegisteredSlots = keyof RegisteredSlotMap & string;
type SlotView<V extends RegisteredSlots> = RegisteredSlotMap[V] extends {
  views: readonly (infer P)[];
}
  ? Extract<P, string>
  : never;
export interface TailorKitInstance<
  TViews extends Record<string, ViewDefinition> = Record<string, ViewDefinition>,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TScopeNames extends string = string,
> {
  readonly $slots?: TSlots;
  readonly $views?: TViews;
  readonly $scopeNames?: TScopeNames;
  readonly baseUrl: string | URL;
  readonly components: Record<string, unknown>;
  readonly theme: TailorKitTheme;
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
      contexts: Record<string, unknown>;
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

type ServerViewMap<TTailor extends TailorKitServerShape> =
  TTailor["$internal"]["schema"]["contexts"];

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

  return {
    baseUrl: options.baseUrl,
    components: wrappedComponents,
    theme,
  };
}

export type { ViewOptions } from "./hooks/use-view";
