import { useEffect, useMemo } from "react";
import type { ViewDefinition } from "@tailorkit/core/schema";
import type { ViewName, ViewState } from "@tailorkit/client-core";
import { useTailorRootContext } from "../components/context";

export type { ViewName, ViewContext, ViewOptions, ViewState } from "@tailorkit/client-core";

type DefaultViews = Record<`/${string}`, ViewDefinition>;

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
  const { context, loading, error } = options;

  useEffect(
    () => () => {
      store.views.unregister(id);
    },
    [id, store],
  );

  useEffect(() => {
    store.views.register({ id, view, context, loading, error });
  }, [id, view, context, loading, error, store]);
}
