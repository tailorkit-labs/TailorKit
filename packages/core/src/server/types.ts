import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ClientOptions as PlatformClientOptions } from "@tailorkit/client-platform/client/types.gen";
import type { TailorKitRouter } from "./router";
import type {
  ActionTree,
  ActionDefinitions,
  ComponentDefinitions,
  NoMixedActionContexts,
  NoComponentFieldCallbackConflicts,
  ResolveActionTreeContext,
  ViewContextHierarchy,
  ContextDefinitions,
  SlotDefinitions,
  SchemaSerializer,
  TailorKitSchema,
} from "../schema/index";

type HeaderInput = ConstructorParameters<typeof Headers>[0];

export interface TailorKitPlatformOptions {
  baseUrl?: PlatformClientOptions["baseUrl"];
  fetch?: typeof fetch;
  headers?: HeaderInput | (() => HeaderInput | Promise<HeaderInput>);
}

export interface TailorKitServerBaseOptions<
  TScopes extends Record<string, StandardSchemaV1> = Record<string, StandardSchemaV1>,
> {
  /**
   * TailorKit.dev project key. The host application must read its
   * `TAILORKIT_PROJECT_KEY` environment variable and pass the value here.
   */
  projectKey?: string;
  /** Standard Schema validators keyed by the names used to identify app scopes. */
  scopes: TScopes;
  /** Optional custom asset origin. Hosted apps receive a tenant-viewd clientPath from TailorKit automatically. */
  assetsBaseUrl?: string;
  /** Convert schemas to JSON Schema for metadata and app type generation. */
  schemaSerializer?: SchemaSerializer;
  basePath?: string;
  /**
   * Configuration for browser-based TailorKit CLI authentication.
   */
  cliAuth?: {
    /**
     * Root-relative path to the host application's sign-in page.
     *
     * When configured, unauthenticated visitors to the CLI approval page are
     * redirected here with a `returnTo` query parameter that points back to
     * the approval page.
     */
    signInPath: `/${string}`;
  };
  /** Configuration for accepted preview invitations. */
  preview?: {
    /**
     * Same-origin root-relative destination after Accept preview or Cancel. Defaults to "/".
     * Must start with a single slash and contain no backslashes or CR/LF.
     * Invalid values throw when the server is created.
     */
    returnPath?: `/${string}`;
  };
  /**
   * Internal TailorKit implementation options.
   *
   * These options are not covered by semantic versioning and may change or
   * break at any time. Avoid using them in application code. If you need one of
   * these hooks, please open a GitHub issue explaining the problem you are
   * solving so we can find a stable public API.
   *
   * @internal
   */
  $internal?: {
    platformBaseUrl?: TailorKitPlatformOptions["baseUrl"];
    platformFetch?: typeof fetch;
    platformHeaders?: TailorKitPlatformOptions["headers"];
  };
}

export interface TailorKitServerSchemaOptions<
  TComponents extends ComponentDefinitions,
  TViews extends ContextDefinitions,
  TActions extends ActionTree = Record<never, never>,
> {
  actions?: TActions & ActionDefinitions & NoMixedActionContexts<TActions>;
  components: TComponents & NoComponentFieldCallbackConflicts<TComponents>;
  views?: TViews & ViewContextHierarchy<TViews>;
  slots?: SlotDefinitions<keyof TViews & string>;
}

export interface TailorKitServerInputOptions extends TailorKitServerBaseOptions {
  slots?: SlotDefinitions;
  actions?: ActionDefinitions;
  components: ComponentDefinitions;
  views?: ContextDefinitions;
}

export type InferTailorKitServerComponents<TOptions extends TailorKitServerInputOptions> =
  TOptions["components"];

export type InferTailorKitServerViews<TOptions extends TailorKitServerInputOptions> =
  TOptions extends { views: infer TViews } ? TViews : Record<never, never>;

/** @deprecated Use InferTailorKitServerViews instead. */
export type InferTailorKitServerContexts<TOptions extends TailorKitServerInputOptions> =
  InferTailorKitServerViews<TOptions>;

export type InferTailorKitServerActions<TOptions extends TailorKitServerInputOptions> =
  TOptions extends { actions: infer TActions } ? TActions : Record<never, never>;

export type TailorKitJsonValue =
  | string
  | number
  | boolean
  | null
  | TailorKitJsonValue[]
  | { [key: string]: TailorKitJsonValue };

/** A JSON object that identifies one named app scope. */
export type TailorKitScope = Record<string, TailorKitJsonValue>;

export interface TailorKitNamedScope {
  name: string;
  value: TailorKitScope;
}

export type TailorKitScopes = Record<string, TailorKitScope>;

export type InferTailorKitServerScopes<TOptions extends TailorKitServerInputOptions> =
  TOptions extends { scopes: infer TSchemas extends Record<string, StandardSchemaV1> }
    ? {
        [TName in keyof TSchemas]: Pick<
          { [TKey in keyof TSchemas]: StandardSchemaV1.InferInput<TSchemas[TKey]> },
          TName
        > &
          Partial<{
            [TKey in Exclude<keyof TSchemas, TName>]: StandardSchemaV1.InferInput<TSchemas[TKey]>;
          }>;
      }[keyof TSchemas]
    : Record<never, never>;

export interface TailorKitServerOptions<
  TComponents extends ComponentDefinitions,
  TViews extends ContextDefinitions,
  TActions extends ActionTree = Record<never, never>,
  TScopes extends Record<string, StandardSchemaV1> = Record<string, StandardSchemaV1>,
>
  extends
    TailorKitServerBaseOptions<TScopes>,
    TailorKitServerSchemaOptions<TComponents, TViews, TActions> {}

export type TailorKitHostContext<TActionContext = never, TScopes = TailorKitScopes> = {
  scopes: TScopes;
} & ([TActionContext] extends [never]
  ? { actionContext?: never }
  : { actionContext: TActionContext });

export interface TailorKitHandlerOptions<TActionContext = never, TScopes = TailorKitScopes> {
  authenticate: (ctx: {
    request: Request;
  }) =>
    | TailorKitHostContext<TActionContext, TScopes>
    | null
    | Promise<TailorKitHostContext<TActionContext, TScopes> | null>;
}

export type TailorKitHandlerContext<
  TActionContext = never,
  TScopes = TailorKitScopes,
> = TailorKitHostContext<TActionContext, TScopes>;

export interface TailorKitServer<
  TComponents extends ComponentDefinitions,
  TViews extends ContextDefinitions,
  TActions extends ActionTree = Record<never, never>,
  TActionContext = ResolveActionTreeContext<TActions>,
  TScopes = TailorKitScopes,
> {
  handler: (
    request: Request,
    options: TailorKitHandlerOptions<TActionContext, TScopes>,
  ) => Response | Promise<Response>;
  /**
   * Internal TailorKit implementation details.
   *
   * This API is not covered by semantic versioning and may change or break at
   * any time. Avoid depending on it in application code. If you need something
   * exposed here, please open a GitHub issue explaining what you are trying to
   * build so we can design a stable public API for that use case.
   *
   * @internal
   */
  $internal: {
    assetsBaseUrl?: string;
    platformBaseUrl: string;
    router: TailorKitRouter;
    schema: TailorKitSchema<TComponents, TViews, TActions>;
  };
}
