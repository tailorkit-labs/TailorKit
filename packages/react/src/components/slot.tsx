import { useStore } from "@nanostores/react";
import { createSlotRuntime, buildThemeCss } from "@tailorkit/client-core";
import type {
  ControlledSlotProps,
  SlotProps,
  RuntimeSlotProps,
  SlotRuntimeOptions,
} from "@tailorkit/client-core";
import type { SlotDefinitions, ViewDefinition } from "@tailorkit/core/schema";
import { useEffect, useId, useMemo } from "react";
import type { ReactNode } from "react";
import { PrimitiveThemeContext } from "../primitives";
import { RemoteViewHost } from "../remote-view";
import { useTailorRootContext } from "./context";

export type { ControlledSlotProps, SlotProps, SlotContext } from "@tailorkit/client-core";

type DefaultViews = Record<`/${string}`, ViewDefinition>;
export type SlotComponent<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TSlots extends SlotDefinitions = SlotDefinitions,
> = ((props: SlotProps<TSlots>) => ReactNode) & {
  Controlled: (props: ControlledSlotProps<TViews, TSlots>) => ReactNode;
};

function ManagedSlot(props: RuntimeSlotProps): ReactNode {
  return <SlotRenderer mode="managed" {...props} />;
}

function ControlledSlot(props: ControlledSlotProps): ReactNode {
  return <SlotRenderer mode="controlled" {...props} />;
}

export const Slot: SlotComponent = Object.assign(ManagedSlot, { Controlled: ControlledSlot });

function SlotRenderer(options: SlotRuntimeOptions): ReactNode {
  const { store, client } = useTailorRootContext(
    options.mode === "managed" ? "Slot" : "Slot.Controlled",
  );
  const reactId = useId();
  const runtime = useMemo(() => createSlotRuntime(store, options), [store]);
  useEffect(() => runtime.setInput(options), [runtime, options]);
  const snapshot = useStore(runtime.state);
  if (snapshot.status === "hidden") return null;
  if (snapshot.status === "loading") return <div role="status">{snapshot.message}</div>;
  if (snapshot.status === "error") return <div role="alert">{snapshot.error.message}</div>;
  const viewId = `tailorkit-view-${reactId.replaceAll(":", "")}`;
  return (
    <PrimitiveThemeContext.Provider value={{ viewId, theme: client.theme }}>
      <div data-tailorkit-view={viewId}>
        <style data-tailorkit-theme-style={viewId}>{buildThemeCss(viewId, client.theme)}</style>
        <RemoteViewHost
          key={snapshot.hostKey}
          appUrl={snapshot.appUrl}
          sourceText={snapshot.sourceText}
          getBackendSession={snapshot.getBackendSession}
          components={client.components}
          props={snapshot.props}
        />
      </div>
    </PrimitiveThemeContext.Provider>
  );
}
