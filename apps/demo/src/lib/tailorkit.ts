import { defineContract } from "tailorkit";
import type { Component, TailorKitTheme } from "tailorkit";
import { primitives } from "tailorkit/zod";
import { z } from "zod";
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

export const createDemoContract = (theme: TailorKitTheme = defaultTheme) => {
  const primitiveTheme = withPrimitiveThemeTokens(theme);

  return defineContract({
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
    views: {
      "/": z.object({}).optional(),
    },
  });
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
