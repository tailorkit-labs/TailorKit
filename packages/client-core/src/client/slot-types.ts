import type { ViewInstance } from "@tailorkit/app/client";
import type { SlotDefinitions, ViewDefinition } from "@tailorkit/core/schema";
import type { ActiveView, ViewStatus } from "@tailorkit/core/views";
import type { TailorKitApp } from "../types";
import type { ViewContext, ViewName } from "../store/local/view-context-types";

type DefaultViews = Record<`/${string}`, ViewDefinition>;
type ContextPaths<TViews extends Record<string, ViewDefinition>, TView extends ViewName<TViews>> = {
  [P in ViewName<TViews>]: P extends "/" | TView ? P : TView extends `${P}/${string}` ? P : never;
}[ViewName<TViews>];
type ContextFields<TView> =
  undefined extends ViewContext<TView>
    ? Partial<Exclude<ViewContext<TView>, undefined>>
    : ViewContext<TView>;

export type SlotContext<
  TViews extends Record<string, ViewDefinition>,
  TView extends ViewName<TViews>,
> = {
  [P in ContextPaths<TViews, TView>]: (context: ContextFields<TViews[P]>) => void;
}[ContextPaths<TViews, TView>] extends (context: infer TContext) => void
  ? TContext
  : never;

export interface RuntimeSlotProps {
  app: TailorKitApp;
  /** The host slot to render in. */
  name: string;
  /** Select an instance of the matching view. */
  instanceKey?: string;
}

type InstanceProps<TSlot, TKey extends string, TValue> = boolean extends (
  TSlot extends { multiple?: infer T } ? T : false
)
  ? { [K in TKey]?: TValue }
  : TSlot extends { multiple: true }
    ? { [K in TKey]: TValue }
    : { [K in TKey]?: never };

export type SlotProps<TSlots extends SlotDefinitions = SlotDefinitions> = {
  [TSlot in keyof TSlots & string]: { app: TailorKitApp; name: TSlot } & InstanceProps<
    TSlots[TSlot],
    "instanceKey",
    string
  >;
}[keyof TSlots & string];

export type ControlledSlotProps<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TSlots extends SlotDefinitions = SlotDefinitions,
> = {
  [TSlot in keyof TSlots & string]: {
    [TView in Extract<ViewName<TViews>, TSlots[TSlot]["views"][number]>]: {
      app: TailorKitApp;
      name: TSlot;
      view: TView;
    } & (
      | ({ context: SlotContext<TViews, TView>; status: "ready" } & InstanceProps<
          TSlots[TSlot],
          "instance",
          ViewInstance
        >)
      | { context?: never; status: "loading" | "error"; instance?: never }
    );
  }[Extract<ViewName<TViews>, TSlots[TSlot]["views"][number]>];
}[keyof TSlots & string];

export type SlotState =
  | ActiveView
  | {
      view: string;
      controlled: true;
      context?: unknown;
      status: ViewStatus;
      instance?: ViewInstance;
    };
