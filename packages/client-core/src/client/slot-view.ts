import { composeViewContext, getViewHierarchy } from "@tailorkit/core/views";
import type { ActiveView } from "@tailorkit/core/views";
import type { TailorKitSchemaSpecType } from "@tailorkit/core/spec";
import type { TailorKitApp } from "../types";

/** Select the supported view without reading or composing its context. */
export function selectSlotView(
  views: NonNullable<TailorKitApp["views"]>,
  slot: string,
  activePath: string,
  schema: TailorKitSchemaSpecType,
) {
  const supported = schema.slots[slot]?.views ?? [];
  const path = getViewHierarchy(activePath).find(
    (path) =>
      supported.includes(path) && views.some((view) => view.slot === slot && view.path === path),
  );
  const view = views.find((view) => view.slot === slot && view.path === path);
  return !view || view.disabled ? null : view;
}

/** Match the same path and compose the same ancestor context as the sandbox renderer. */
export function resolveSlotView(
  views: NonNullable<TailorKitApp["views"]>,
  slot: string,
  activeView: ActiveView,
  schema: TailorKitSchemaSpecType,
) {
  const view = selectSlotView(views, slot, activeView.view, schema);
  if (!view) return null;
  return {
    ...composeViewContext(view.path, {
      layers: activeView.layers,
      declaredViews: Object.keys(schema.views),
    }),
    instances: Boolean(view.instances),
  };
}
