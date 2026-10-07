import type { tailorKit } from "./tailorkit";
import { primitiveTheme } from "@examples/shared";
import { primitives as reactPrimitives, createTailorKitClient } from "tailorkit/react";
import { Button } from "@tailorkit/ui/button";
import { Input } from "@tailorkit/ui/input";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@tailorkit/ui/tabs";
import { Textarea } from "@tailorkit/ui/textarea";

export const tailor = createTailorKitClient<typeof tailorKit>({
  baseUrl:
    typeof window === "undefined"
      ? "http://localhost/api/tailorkit/"
      : new URL("/api/tailorkit/", window.location.origin),
  theme: primitiveTheme,
  components: {
    ...reactPrimitives,
    Button: ({ props, children }) => <Button {...props}>{children}</Button>,
    Input: ({ props: { onValueChange, ...rest }, children }) => (
      <Input onChange={(e) => onValueChange({ value: e.target.value })} {...rest}>
        {children}
      </Input>
    ),
    Tabs: ({ props, children }) => <Tabs {...props}>{children}</Tabs>,
    TabsList: ({ props, children }) => <TabsList {...props}>{children}</TabsList>,
    TabsTab: ({ props, children }) => <TabsTab {...props}>{children}</TabsTab>,
    TabsPanel: ({ props, children }) => <TabsPanel {...props}>{children}</TabsPanel>,
    TextArea: ({ props: { onValueChange, ...rest }, children }) => (
      <Textarea onChange={(e) => onValueChange({ value: e.target.value })} {...rest}>
        {children}
      </Textarea>
    ),
  },
});

export const { Slot, useApps, useRegisterView, useSlot } = tailor;

export default tailor;
