import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ActionDefinition } from "./actions";
import type { ComponentDefinitions, NoComponentFieldCallbackConflicts } from "./components";
import type { Schema } from "./shared";
import type { ContextDefinitions, SlotDefinitions, ViewContextHierarchy } from "./views";

export interface ContractAction<
  TInput extends Schema | undefined = Schema | undefined,
  TOutput extends Schema | undefined = Schema | undefined,
> {
  readonly $tailorkitActionDefinition: true;
  readonly definition: ActionDefinition<TInput, TOutput>;
  input<const TNext extends Schema>(schema: TNext): ContractAction<TNext, TOutput>;
  output<const TNext extends Schema>(schema: TNext): ContractAction<TInput, TNext>;
}

export interface ContractActions {
  [name: string]: ContractAction | ContractActions;
}

function actionDefinition<TInput extends Schema | undefined, TOutput extends Schema | undefined>(
  input?: TInput,
  output?: TOutput,
): ContractAction<TInput, TOutput> {
  return {
    $tailorkitActionDefinition: true,
    definition: { input, output },
    input: (schema) => actionDefinition(schema, output),
    output: (schema) => actionDefinition(input, schema),
  };
}

/** Declare an action's public input and output without importing its implementation. */
export function action(): ContractAction<undefined, undefined> {
  return actionDefinition<undefined, undefined>();
}

export interface TailorKitContract<
  TComponents extends ComponentDefinitions = ComponentDefinitions,
  TViews extends ContextDefinitions = ContextDefinitions,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TActions extends ContractActions = ContractActions,
  TScopes extends Record<string, StandardSchemaV1> = Record<string, StandardSchemaV1>,
> {
  readonly components: TComponents;
  readonly views: TViews;
  readonly slots: TSlots;
  readonly actions: TActions;
  readonly scopes: TScopes;
}

/** Define the browser-safe interface shared by a host server and its clients. */
export function defineContract<
  const TComponents extends ComponentDefinitions = Record<never, never>,
  const TViews extends ContextDefinitions = Record<never, never>,
  const TSlots extends SlotDefinitions = Record<never, never>,
  const TActions extends ContractActions = Record<never, never>,
  const TScopes extends Record<string, Schema> = Record<never, never>,
>(definition: {
  components?: TComponents & NoComponentFieldCallbackConflicts<NoInfer<TComponents>>;
  views?: TViews & ViewContextHierarchy<NoInfer<TViews>>;
  slots?: TSlots & SlotDefinitions<keyof NoInfer<TViews> & string>;
  actions?: TActions;
  scopes?: TScopes;
}): TailorKitContract<TComponents, TViews, TSlots, TActions, TScopes> {
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
    actions: (definition.actions ?? {}) as TActions,
    scopes: (definition.scopes ?? {}) as TScopes,
  };
}
