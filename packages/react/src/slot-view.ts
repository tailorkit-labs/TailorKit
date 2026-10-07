import { composeViewContext, getViewHierarchy } from "@tailorkit/core/views";
import type { ActiveView } from "@tailorkit/core/views";
import type { TailorKitSchemaSpecType } from "@tailorkit/core/spec";
import type { TailorKitApp } from "./tailorkit";

/** Match the same path and compose the same ancestor context as the sandbox renderer. */
export function resolveSlotView(
  views: NonNullable<TailorKitApp["views"]>,
  slot: string,
  activeView: ActiveView,
  schema: TailorKitSchemaSpecType,
) {
  const supported = schema.slots[slot]?.views ?? [];
  const path = getViewHierarchy(activeView.view).find(
    (path) =>
      supported.includes(path) && views.some((view) => view.slot === slot && view.path === path),
  );
  const view = views.find((view) => view.slot === slot && view.path === path);
  if (!view || view.disabled) return null;
  return {
    ...composeViewContext(view.path, {
      layers: activeView.layers,
      declaredViews: Object.keys(schema.views),
    }),
    instances: Boolean(view.instances),
  };
}
