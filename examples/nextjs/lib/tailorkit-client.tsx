"use client";

import { contract } from "./tailorkit";
import { primitiveTheme } from "@examples/shared";
import { Button } from "@tailorkit/ui/button";
import { Input } from "@tailorkit/ui/input";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@tailorkit/ui/tabs";
import { Textarea } from "@tailorkit/ui/textarea";
import { createClient, primitives as reactPrimitives } from "tailorkit/react";

export const tailor = createClient({
  contract,
  baseUrl:
    typeof window === "undefined"
      ? "http://localhost:5020/api/tailorkit/"
      : new URL("/api/tailorkit/", window.location.origin),
  theme: primitiveTheme,
  components: {
    ...reactPrimitives,
    Button: ({ props, children }) => <Button {...props}>{children}</Button>,
    Input: ({ props: { onValueChange, ...rest }, children }) => (
      <Input onChange={(event) => onValueChange({ value: event.target.value })} {...rest}>
        {children}
      </Input>
    ),
    Tabs: ({ props, children }) => <Tabs {...props}>{children}</Tabs>,
    TabsList: ({ props, children }) => <TabsList {...props}>{children}</TabsList>,
    TabsTab: ({ props, children }) => <TabsTab {...props}>{children}</TabsTab>,
    TabsPanel: ({ props, children }) => <TabsPanel {...props}>{children}</TabsPanel>,
    TextArea: ({ props: { onValueChange, ...rest }, children }) => (
      <Textarea onChange={(event) => onValueChange({ value: event.target.value })} {...rest}>
        {children}
      </Textarea>
    ),
  },
});

export const {
  Provider: TailorKitProvider,
  RenderSlot,
  useApps,
  useViewContext,
  useViews,
} = tailor;

export default tailor;
