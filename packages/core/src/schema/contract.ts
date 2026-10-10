import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ContractTools } from "./tools";
import { flattenTools } from "./tools";
import type { ComponentDefinitions, NoComponentFieldCallbackConflicts } from "./components";
import type { Schema } from "./shared";
import type { ContextDefinitions, SlotDefinitions, ViewContextHierarchy } from "./views";

export interface TailorKitContract<
  TComponents extends ComponentDefinitions = ComponentDefinitions,
  TViews extends ContextDefinitions = ContextDefinitions,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TTools extends ContractTools = ContractTools,
  TScopes extends Record<string, StandardSchemaV1> = Record<string, StandardSchemaV1>,
> {
  readonly components: TComponents;
  readonly views: TViews;
  readonly slots: TSlots;
  readonly tools: TTools;
  readonly scopes: TScopes;
}

/** Define the browser-safe interface shared by a host server and its clients. */
export function defineContract<
  const TComponents extends ComponentDefinitions = Record<never, never>,
  const TViews extends ContextDefinitions = Record<never, never>,
  const TSlots extends SlotDefinitions = Record<never, never>,
  const TTools extends ContractTools = Record<never, never>,
  const TScopes extends Record<string, Schema> = Record<never, never>,
>(definition: {
  components?: TComponents & NoComponentFieldCallbackConflicts<NoInfer<TComponents>>;
  views?: TViews & ViewContextHierarchy<NoInfer<TViews>>;
  slots?: TSlots & SlotDefinitions<keyof NoInfer<TViews> & string>;
  tools?: TTools;
  scopes?: TScopes;
}): TailorKitContract<TComponents, TViews, TSlots, TTools, TScopes> {
  for (const name of Object.keys(definition))
    if (!["components", "views", "slots", "tools", "scopes"].includes(name))
      throw new Error(`Unknown contract field "${name}"`);
  flattenTools(definition.tools ?? {});
  for (const [name, slot] of Object.entries(definition.slots ?? {})) {
    if (slot.multiple !== undefined && typeof slot.multiple !== "boolean") {
      throw new TypeError(`Slot "${name}" multiple must be a boolean.`);
    }
    for (const view of slot.views) {
      if (!Object.hasOwn(definition.views ?? {}, view)) {
        throw new Error(`Slot "${name}" references undeclared view "${view}".`);
      }
    }
  }
  return {
    components: (definition.components ?? {}) as TComponents,
    views: (definition.views ?? {}) as TViews,
    slots: (definition.slots ?? {}) as TSlots,
    tools: (definition.tools ?? {}) as TTools,
    scopes: (definition.scopes ?? {}) as TScopes,
  };
}
