import { createTailorKit } from "tailorkit";
import type { Component, TailorKitTheme } from "tailorkit";
import { primitives } from "tailorkit/zod";
import { createTailorKitClient, primitives as reactPrimitives } from "tailorkit/react";
import type React from "react";
import { z } from "zod";
import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tailorkit/ui/dropdown-menu";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@tailorkit/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@tailorkit/ui/card";
import { Checkbox } from "@tailorkit/ui/checkbox";
import { Input } from "@tailorkit/ui/input";
import { Separator } from "@tailorkit/ui/separator";
import { defaultTheme, withPrimitiveThemeTokens } from "./demo-theme";

const component = <const TComponent extends Component>(definition: TComponent): TComponent =>
  definition;

const ButtonComponent = component({
  callbacks: {
    onClick: {},
  },
  fields: z.object({
    size: z.enum(["default", "sm", "lg", "icon", "icon-sm", "icon-lg"]).optional(),
    variant: z.enum(["default", "secondary", "ghost", "outline", "destructive"]).optional(),
  }),
  children: true,
});

const BadgeComponent = component({
  fields: z.object({
    size: z.enum(["default", "sm", "lg"]).optional(),
    variant: z
      .enum(["default", "secondary", "outline", "success", "warning", "info", "error"])
      .optional(),
  }),
  children: true,
});

const CheckboxComponent = component({
  callbacks: {
    onCheckedChange: {
      input: z.boolean(),
    },
  },
  fields: z.object({
    checked: z.string().optional(),
  }),
});

const CardComponent = component({ children: true });
const CardHeaderComponent = component({ children: true });
const CardTitleComponent = component({ children: true });
const CardDescriptionComponent = component({ children: true });
const CardContentComponent = component({ children: true });
const CardFooterComponent = component({ children: true });

const InputComponent = component({
  callbacks: {
    onValueChange: {
      input: z.string(),
    },
  },
  fields: z.object({
    placeholder: z.string().optional(),
    value: z.string().optional(),
  }),
});

const TabsComponent = component({
  fields: z.object({
    value: z.string().optional(),
  }),
  callbacks: {
    onValueChange: {
      input: z.string(),
    },
  },
  children: true,
});

const TabsListComponent = component({
  children: true,
});

const TabsTabComponent = component({
  fields: z.object({
    value: z.string(),
  }),
  children: true,
});

const TabsPanelComponent = component({
  fields: z.object({
    value: z.string(),
  }),
  children: true,
});

const SeparatorComponent = component({});

const DropdownMenuComponent = component({ children: true });
const DropdownMenuTriggerComponent = component({ children: true });
const DropdownMenuContentComponent = component({ children: true });
const DropdownMenuItemComponent = component({
  callbacks: { onClick: {} },
  fields: z.object({
    variant: z.enum(["default", "destructive"]).optional(),
  }),
  children: true,
});
const DropdownMenuSeparatorComponent = component({});

export const createDemoSchema = (theme: TailorKitTheme = defaultTheme) => {
  const primitiveTheme = withPrimitiveThemeTokens(theme);

  return {
    scopes: { demo: z.object({ demoId: z.string().min(1) }) },
    components: {
      ...primitives(primitiveTheme),
      Badge: BadgeComponent,
      Button: ButtonComponent,
      Card: CardComponent,
      DropdownMenu: DropdownMenuComponent,
      DropdownMenuContent: DropdownMenuContentComponent,
      DropdownMenuItem: DropdownMenuItemComponent,
      DropdownMenuSeparator: DropdownMenuSeparatorComponent,
      DropdownMenuTrigger: DropdownMenuTriggerComponent,
      CardContent: CardContentComponent,
      CardDescription: CardDescriptionComponent,
      CardFooter: CardFooterComponent,
      CardHeader: CardHeaderComponent,
      CardTitle: CardTitleComponent,
      Checkbox: CheckboxComponent,
      Input: InputComponent,
      Separator: SeparatorComponent,
      Tabs: TabsComponent,
      TabsList: TabsListComponent,
      TabsTab: TabsTabComponent,
      TabsPanel: TabsPanelComponent,
    },
    slots: { panel: { views: ["/"] } },
    contexts: {
      "/": z.object({}).optional(),
    },
  } as const;
};

export const demoApps = [
  {
    clientPath: "/tailorkit-clients/todo.js",
    description: "A compact task workspace for customer onboarding demos.",
    id: "todo",
    name: "My Tasks",
  },
  {
    clientPath: "/tailorkit-clients/messages.js",
    description: "A compact team inbox for messaging demos.",
    id: "messages",
    name: "Team Inbox",
  },
];

export function createDemoTailorClient(theme: TailorKitTheme) {
  const server = createTailorKit(createDemoSchema(theme));

  return createTailorKitClient<typeof server>({
    baseUrl:
      typeof window === "undefined"
        ? "http://localhost/api/tailorkit/"
        : new URL("/api/tailorkit/", window.location.origin),
    components: {
      ...reactPrimitives,
      Button: ({ props, children }) => (
        <Button
          onClick={typeof props.onClick === "function" ? props.onClick : undefined}
          size={props.size as React.ComponentProps<typeof Button>["size"]}
          variant={props.variant as React.ComponentProps<typeof Button>["variant"]}
        >
          {children}
        </Button>
      ),
      Badge: ({ props, children }) => (
        <Badge
          size={props.size as React.ComponentProps<typeof Badge>["size"]}
          variant={props.variant as React.ComponentProps<typeof Badge>["variant"]}
        >
          {children}
        </Badge>
      ),
      Card: ({ children }) => <Card>{children}</Card>,
      CardHeader: ({ children }) => <CardHeader>{children}</CardHeader>,
      CardTitle: ({ children }) => <CardTitle>{children}</CardTitle>,
      CardDescription: ({ children }) => <CardDescription>{children}</CardDescription>,
      CardContent: ({ children }) => <CardContent>{children}</CardContent>,
      CardFooter: ({ children }) => <CardFooter>{children}</CardFooter>,
      Checkbox: ({ props }) => (
        <Checkbox
          checked={props.checked === "true"}
          onCheckedChange={
            typeof props.onCheckedChange === "function"
              ? (checked: boolean) => props.onCheckedChange(checked)
              : undefined
          }
        />
      ),
      Input: ({ props }) => {
        const handleInput =
          typeof props.onValueChange === "function"
            ? (event: { target: EventTarget | null }) =>
                props.onValueChange((event.target as HTMLInputElement).value)
            : undefined;

        return (
          <Input
            nativeInput
            onChange={handleInput}
            onInput={handleInput}
            placeholder={typeof props.placeholder === "string" ? props.placeholder : undefined}
            value={typeof props.value === "string" ? props.value : undefined}
          />
        );
      },
      Separator: () => <Separator />,
      DropdownMenu: ({ children }) => <DropdownMenu>{children}</DropdownMenu>,
      DropdownMenuTrigger: ({ children }) => <DropdownMenuTrigger>{children}</DropdownMenuTrigger>,
      DropdownMenuContent: ({ children }) => <DropdownMenuContent>{children}</DropdownMenuContent>,
      DropdownMenuItem: ({ props, children }) => (
        <DropdownMenuItem
          onClick={typeof props.onClick === "function" ? props.onClick : undefined}
          variant={props.variant as React.ComponentProps<typeof DropdownMenuItem>["variant"]}
        >
          {children}
        </DropdownMenuItem>
      ),
      DropdownMenuSeparator: () => <DropdownMenuSeparator />,
      Tabs: ({ props, children }) => (
        <Tabs
          value={typeof props.value === "string" ? props.value : undefined}
          onValueChange={
            typeof props.onValueChange === "function" ? props.onValueChange : undefined
          }
        >
          {children}
        </Tabs>
      ),
      TabsList: ({ children }) => <TabsList>{children}</TabsList>,
      TabsTab: ({ props, children }) => (
        <TabsTab value={typeof props.value === "string" ? props.value : ""}>{children}</TabsTab>
      ),
      TabsPanel: ({ props, children }) => (
        <TabsPanel value={typeof props.value === "string" ? props.value : ""}>{children}</TabsPanel>
      ),
    },
  });
}
