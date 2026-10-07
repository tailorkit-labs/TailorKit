import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createTailorKitStore, toBaseUrl } from "@tailorkit/client-core";
import type { TailorKitApp, TailorKitClientConfig } from "../tailorkit";
import type { ComponentProps } from "./render";
import { mergeProps, useRender } from "./render";
import { TailorRootContext } from "./context";
import type { TailorRootContextValue } from "./context";

export interface RootProps extends ComponentProps<"div"> {
  apps?: TailorKitApp[];
  children?: ReactNode;
  client: TailorKitClientConfig;
}

export function Root({ apps: appsProp, children, render, client, ...props }: RootProps): ReactNode {
  const baseUrl = toBaseUrl(client.baseUrl).toString();
  const [previousStore, setStore] = useState(() =>
    createTailorKitStore(baseUrl, appsProp, client.fetchClient),
  );
  let store = previousStore;
  if (
    previousStore.baseUrl.toString() !== baseUrl ||
    (client.fetchClient && previousStore.client !== client.fetchClient)
  ) {
    store = createTailorKitStore(baseUrl, appsProp, client.fetchClient);
    setStore(store);
  }
  useEffect(() => {
    store.setProvidedApps(appsProp);
  }, [store, appsProp]);
  useEffect(() => () => store.previews.dispose(), [store]);

  const context = useMemo<TailorRootContextValue>(
    () => ({
      store,
      client,
    }),
    [store, client],
  );

  const element = render
    ? useRender({
        defaultTagName: "div",
        props: mergeProps({ children }, props),
        render,
      })
    : children;

  return <TailorRootContext.Provider value={context}>{element}</TailorRootContext.Provider>;
}
