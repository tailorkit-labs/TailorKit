import type { TailorKitStore } from "../store";
import { createContext, useContext } from "react";

import type { TailorKitClientConfig } from "../tailorkit";

export interface TailorRootContextValue {
  store: TailorKitStore;
  client: TailorKitClientConfig;
}

export const TailorRootContext = createContext<TailorRootContextValue | null>(null);

export function useTailorRootContext(
  component: string,
  expectedClient?: TailorKitClientConfig,
): TailorRootContextValue {
  const context = useContext(TailorRootContext);
  if (!context) {
    throw new Error(`${component} must be rendered inside Root.`);
  }
  if (expectedClient && context.client !== expectedClient) {
    throw new Error(
      `${component} was created for a different TailorKit client than the one passed to Root.`,
    );
  }
  return context;
}
