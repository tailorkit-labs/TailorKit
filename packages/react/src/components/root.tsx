import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createTailorKitStore, toBaseUrl } from "../store";
import type { TailorKitApp, TailorKitInstance } from "../tailor-kit";
import type { ComponentProps } from "./render";
import { mergeProps, useRender } from "./render";
import { TailorRootContext } from "./context";
import type { TailorRootContextValue } from "./context";

export interface RootProps extends ComponentProps<"div"> {
  apps?: TailorKitApp[];
  children?: ReactNode;
  client: TailorKitInstance;
}

export function Root({ apps: appsProp, children, render, client, ...props }: RootProps): ReactNode {
  const baseUrl = toBaseUrl(client.baseUrl).toString();
  const [previousStore, setStore] = useState(() => createTailorKitStore(baseUrl, appsProp));
  let store = previousStore;
  if (previousStore.baseUrl.toString() !== baseUrl) {
    store = createTailorKitStore(baseUrl, appsProp);
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
