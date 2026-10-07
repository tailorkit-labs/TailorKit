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

interface ReadyViewOptions<
  TViews extends Record<string, ViewDefinition>,
  TView extends ViewName<TViews>,
> {
  context: ViewContext<TViews[TView]>;
  view: TView;
  status?: "ready";
}

interface LoadingViewOptions<TView extends string> {
  context?: never;
  view: TView;
  status: "loading";
}

interface ErrorViewOptions<TView extends string> {
  context?: never;
  view: TView;
  status: "error";
}

export type ViewOptions<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TView extends ViewName<TViews> = ViewName<TViews>,
> =
  TView extends ViewName<TViews>
    ? ReadyViewOptions<TViews, TView> | LoadingViewOptions<TView> | ErrorViewOptions<TView>
    : never;

export type ViewState<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TView extends ViewName<TViews> = ViewName<TViews>,
> =
  | Omit<ReadyViewOptions<TViews, TView>, "view">
  | Omit<LoadingViewOptions<TView>, "view">
  | Omit<ErrorViewOptions<TView>, "view">;

export type UseRegisterView<TViews extends Record<string, ViewDefinition>> = <
  TView extends ViewName<TViews>,
>(
  view: TView,
  options: ViewState<TViews, NoInfer<TView>>,
) => void;

export function useRegisterView<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TView extends ViewName<TViews> = ViewName<TViews>,
>(view: TView, options: ViewState<TViews, NoInfer<TView>>): void {
  const { store } = useTailorRootContext("useRegisterView");
  const id = useMemo(() => Symbol("tailorkit-current-view"), []);
  const status = options.status ?? "ready";
  const context = "context" in options ? options.context : undefined;
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
