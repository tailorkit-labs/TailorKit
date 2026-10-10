import type { ViewDefinition } from "@tailorkit/core/schema";

type DefaultViews = Record<`/${string}`, ViewDefinition>;

export type ViewName<TViews extends Record<string, ViewDefinition>> = keyof TViews & string;

export type ViewContext<TView> = TView extends ViewDefinition
  ? NonNullable<TView["~standard"]["types"]>["output"]
  : Record<string, never>;

export type ViewContextInput<TView> = TView extends ViewDefinition
  ? NonNullable<TView["~standard"]["types"]>["input"]
  : Record<string, never>;

export interface ViewContextState<TContext = unknown> {
  /** The complete context for this view, or undefined while it is unavailable. */
  context: TContext | undefined;
  /** Defaults to false. Loading views do not publish context. */
  loading?: boolean;
  /**
   * True, any string (including ""), or an Error marks the view as failed.
   * False, null, and undefined mean no error. Errors take precedence over loading
   * and prevent the view from publishing context.
   */
  error?: boolean | string | Error | null;
}

export type ViewState<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TView extends ViewName<TViews> = ViewName<TViews>,
> = ViewContextState<ViewContextInput<TViews[TView]>>;

export type ViewOptions<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TView extends ViewName<TViews> = ViewName<TViews>,
> = TView extends ViewName<TViews> ? ViewState<TViews, TView> & { view: TView } : never;

export interface ViewContextRegistration<TContext = unknown> extends ViewContextState<TContext> {
  id: symbol;
  view: string;
}
