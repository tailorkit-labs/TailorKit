import { useStableContext } from "./use-stable-context";
import { useEffect, useMemo } from "react";
import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import type { ViewDefinition } from "@tailorkit/core/schema";
import { useTailorRootContext } from "../components/context";

type DefaultViews = Record<`/${string}`, ViewDefinition>;

export type ViewName<TViews extends Record<string, ViewDefinition>> = keyof TViews & string;

export type ViewContext<TView> = TView extends StandardJSONSchemaV1
  ? StandardJSONSchemaV1.InferOutput<TView>
  : Record<string, never>;

export interface ViewState<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TView extends ViewName<TViews> = ViewName<TViews>,
> {
  /** The complete context for this view, or undefined while it is unavailable. */
  context: ViewContext<TViews[TView]> | undefined;
  /** Defaults to false. Loading views do not publish context. */
  loading?: boolean;
  /** Takes precedence over loading. Error views do not publish context. */
  error?: Error | null;
}

export type ViewOptions<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TView extends ViewName<TViews> = ViewName<TViews>,
> = TView extends ViewName<TViews> ? ViewState<TViews, TView> & { view: TView } : never;

export type UseViewContext<TViews extends Record<string, ViewDefinition>> = <
  TView extends ViewName<TViews>,
>(
  view: TView,
  options: ViewState<TViews, NoInfer<TView>>,
) => void;

export function useViewContext<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TView extends ViewName<TViews> = ViewName<TViews>,
>(view: TView, options: ViewState<TViews, NoInfer<TView>>): void {
  const { store } = useTailorRootContext("useViewContext");
  const id = useMemo(() => Symbol("tailorkit-current-view"), []);
  const status = options.error != null ? "error" : options.loading ? "loading" : "ready";
  const context = status === "ready" ? options.context : undefined;
  const contextSnapshot = useStableContext(context);

  useEffect(
    () => () => {
      store.views.unregister(id);
    },
    [id, store],
  );

  useEffect(() => {
    store.views.register({
      context: contextSnapshot,
      id,
      view,
      status,
    });
  }, [contextSnapshot, id, view, status, store]);
}
