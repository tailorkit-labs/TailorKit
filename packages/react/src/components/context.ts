import type { TailorKitStore } from "@tailorkit/client-core";
import { createContext, useContext } from "react";

import type { TailorKitClientConfig } from "../tailorkit";

export interface TailorkitContextValue {
  store: TailorKitStore;
  client: TailorKitClientConfig;
}

export const TailorkitContext = createContext<TailorkitContextValue | null>(null);

export function useTailorkitContext(
  component: string,
  expectedClient?: TailorKitClientConfig,
): TailorkitContextValue {
  const context = useContext(TailorkitContext);
  if (!context) {
    throw new Error(`${component} must be rendered inside a TailorKit Provider.`);
  }
  if (expectedClient && context.client !== expectedClient) {
    throw new Error(
      `${component} was created for a different TailorKit client than the surrounding Provider.`,
    );
  }
  return context;
}
