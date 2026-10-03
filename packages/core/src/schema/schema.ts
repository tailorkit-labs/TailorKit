import type { TailorKitSchemaSpec } from "../spec/index";
import type { ActionTree, NoMixedActionContexts } from "./actions";
import { serializeActions } from "./actions";
import type {
  ComponentDefinitions,
  NoComponentFieldCallbackConflicts,
  ResolvedComponentMetadata,
} from "./components";
import { resolveComponentMetadata } from "./components";
import type {
  ResolvedViewMetadata,
  ViewContextHierarchy,
  ContextDefinitions,
  SlotDefinitions,
} from "./views";
import { jsonSchemaSerializer, serializeSchema } from "./shared";
import type { Schema, SchemaSerializer } from "./shared";

type EmptyActionMap = Record<never, never>;

export interface TailorKitSchema<
  TComponents extends Record<string, unknown> = ComponentDefinitions,
  TContexts extends Record<string, unknown> = ContextDefinitions,
  TActions extends ActionTree = EmptyActionMap,
> {
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
    actions: TActions;
    components: {
      [TName in keyof TComponents]: ResolvedComponentMetadata;
    };
    views: {
      [TName in keyof TContexts]: ResolvedViewMetadata;
    };
  };
  slots: SlotDefinitions;
  actions: TActions;
  components: TComponents;
  contexts: TContexts;
  serialize(schemaSerializer?: SchemaSerializer): TailorKitSchemaSpec;
}

export const createTailorKitSchema = <
  const TComponents extends Record<string, unknown>,
  const TContexts extends ContextDefinitions = Record<string, never>,
  const TActions extends ActionTree = EmptyActionMap,
>(schema: {
  slots?: SlotDefinitions<keyof NoInfer<TContexts> & string>;
  actions?: TActions & NoMixedActionContexts<NoInfer<TActions>>;
  components: TComponents & NoComponentFieldCallbackConflicts<NoInfer<TComponents>>;
  contexts?: TContexts & ViewContextHierarchy<NoInfer<TContexts>>;
}): TailorKitSchema<TComponents, TContexts, TActions> => {
  for (const [name, slot] of Object.entries(schema.slots ?? {})) {
    for (const view of slot.views) {
      if (!Object.hasOwn(schema.contexts ?? {}, view)) {
        throw new Error(`Slot "${name}" references undeclared view "${view}".`);
      }
    }
  }
  const components = {} as TailorKitSchema<
    TComponents,
    TContexts,
    TActions
  >["$internal"]["components"];
  const views = {} as TailorKitSchema<TComponents, TContexts, TActions>["$internal"]["views"];

  for (const [name, definition] of Object.entries(schema.components as ComponentDefinitions)) {
    components[name as keyof TComponents] = resolveComponentMetadata(name, definition);
  }

  for (const [name, context] of Object.entries((schema.contexts ?? {}) as ContextDefinitions)) {
    views[name as keyof TContexts] = { context };
  }

  const serialize = (
    schemaSerializer: SchemaSerializer = jsonSchemaSerializer,
  ): TailorKitSchemaSpec => {
    const serializedComponents: TailorKitSchemaSpec["components"] = {};
    const serializedViews: TailorKitSchemaSpec["views"] = {};

    for (const [name, metadata] of Object.entries(components)) {
      const callbacks: TailorKitSchemaSpec["components"][string]["callbacks"] = {};
      for (const [callbackName, callback] of Object.entries(metadata.callbacks)) {
        if (callback === undefined) {
          continue;
        }
        callbacks[callbackName] = {
          async: callback.async,
          input: serializeSchema(callback.input, schemaSerializer),
          output: serializeSchema(callback.output, schemaSerializer),
        };
      }

      serializedComponents[name] = {
        callbacks,
        fields: serializeSchema(metadata.fields, schemaSerializer),
        children: metadata.children,
      };
    }

    for (const [name, metadata] of Object.entries(views)) {
      serializedViews[name] = {
        context: serializeSchema(metadata.context, schemaSerializer),
        ...(metadata.context && contextMayBeOmitted(metadata.context)
          ? { contextOptional: true }
          : {}),
      };
    }

    return {
      actions: serializeActions(schema.actions ?? {}, schemaSerializer),
      components: serializedComponents,
      views: serializedViews,
      slots: Object.fromEntries(
        Object.entries(schema.slots ?? {}).map(([name, slot]) => [
          name,
          { views: [...slot.views] },
        ]),
      ),
      version: 1,
    };
  };

  return {
    slots: schema.slots ?? {},
    actions: (schema.actions ?? {}) as TActions,
    components: schema.components,
    contexts: (schema.contexts ?? {}) as TContexts,
    serialize,
    $internal: {
      actions: (schema.actions ?? {}) as TActions,
      components,
      views,
    },
  };
};

export type { TailorKitTheme } from "../primitives/theme";
export {
  createActions,
  type Action,
  type ActionDefinition,
  type ActionDefinitions,
  type ActionHandler,
  type Actions,
  type ActionTree,
  type HandlerArgs,
  type ImplementedAction,
  type InferActionInput,
  type InferActionOutput,
  type InferActionTreeContext,
  type NoMixedActionContexts,
  type ResolveActionTreeContext,
} from "./actions";
export {
  type Callback,
  type CallbackDefinition,
  type CallbackMap,
  type Callbacks,
  type InferCallback,
  type InferCallbacks,
} from "./callbacks";
export {
  type Component,
  type ComponentDefinition,
  type ComponentDefinitions,
  type ComponentProps,
  type Components,
  type Fields,
  type NoComponentFieldCallbackConflicts,
  type ResolvedComponentMetadata,
} from "./components";
export {
  type ResolvedViewMetadata,
  type View,
  type ViewContextHierarchy,
  type ViewDefinition,
  type ViewDefinitions,
  type ContextDefinitions,
  type Views,
  type SlotDefinitions,
} from "./views";
export { jsonSchemaSerializer, type Schema, type SchemaSerializer } from "./shared";
export type { TailorKitSchema as TailorKit };

// JSON Schema cannot represent undefined at its root. Preserve that information
// separately before sending the schema to app type generation.
function contextMayBeOmitted(schema: Schema): boolean {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Probe whether the schema accepts an omitted context.
  const result = schema["~standard"].validate(undefined);
  if (result instanceof Promise) {
    // Serialization is synchronous; conservatively allow omission for async schemas.
    void result.catch(() => {});
    return true;
  }
  return !result.issues;
}
