import { useStableContext } from "./use-stable-context";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import type { ViewDefinition } from "@tailorkit/core/schema";
import { createViewContextValidator } from "@tailorkit/core/spec";
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
  const metadata = useSyncExternalStore(
    store.subscribe,
    store.getMetaSnapshot,
    store.getMetaSnapshot,
  );
  const definition = metadata.schema?.views[view];
  const validation = useMemo(() => {
    if (!definition?.context) return null;
    try {
      return { validate: createViewContextValidator(definition.context) };
    } catch (error) {
      return { error };
    }
  }, [definition?.context]);
  const lastDiagnostic = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    // Let Slot/useViews start their shared metadata request before diagnostics do.
    queueMicrotask(() => {
      if (active && store.getMetaSnapshot().status === "idle") {
        void store.fetchMeta();
      }
    });
    return () => {
      active = false;
    };
  }, [store]);

  useEffect(() => {
    if (status !== "ready" || !definition) {
      lastDiagnostic.current = null;
      return;
    }
    let diagnostic: { message: string; details?: unknown } | null = null;
    if (contextSnapshot === undefined) {
      if (!definition.contextOptional) {
        diagnostic = {
          message: `TailorKit useViewContext("${view}") is ready without its required context. Supply context or set loading: true while it is unavailable.`,
        };
      }
    } else if (
      contextSnapshot === null ||
      typeof contextSnapshot !== "object" ||
      Array.isArray(contextSnapshot)
    ) {
      diagnostic = {
        message: `TailorKit useViewContext("${view}") requires an object context that matches the view's schema.`,
      };
    } else if (validation && "error" in validation) {
      diagnostic = {
        message: `TailorKit could not validate context for view "${view}" against its JSON Schema.`,
        details: validation.error,
      };
    } else if (validation) {
      const issues = validation.validate(contextSnapshot);
      if (issues) {
        diagnostic = {
          message: `TailorKit useViewContext("${view}") received context that does not match the view's schema.`,
          details: issues,
        };
      }
    }
    const key = diagnostic ? JSON.stringify([view, contextSnapshot, diagnostic.message]) : null;
    if (key !== lastDiagnostic.current) {
      lastDiagnostic.current = key;
      if (diagnostic) {
        if (diagnostic.details === undefined) {
          console.error(diagnostic.message);
        } else {
          console.error(diagnostic.message, diagnostic.details);
        }
      }
    }
  }, [contextSnapshot, definition, status, validation, view]);

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
