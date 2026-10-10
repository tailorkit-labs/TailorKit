import { tool, defineContract } from "tailorkit";
import type { Component, ContextDefinitions } from "tailorkit";
import { primitives } from "tailorkit/zod";
import { z } from "zod";

const Button = {
  fields: z.object({
    size: z.enum(["default", "sm", "lg", "icon", "icon-sm", "icon-lg"]).optional(),
    variant: z.enum(["default", "secondary", "ghost", "outline", "destructive"]).optional(),
  }),
  callbacks: {
    onClick: {},
  },
  children: true,
} as const satisfies Component;

const Tabs = {
  fields: z.object({
    value: z.string(),
  }),
  callbacks: {
    onValueChange: {
      input: z.object({ value: z.string() }),
    },
  },
  children: true,
} as const satisfies Component;

const TabsList = {
  children: true,
} as const satisfies Component;

const TabsTab = {
  fields: z.object({
    value: z.string(),
  }),
  children: true,
} as const satisfies Component;

const TabsPanel = {
  fields: z.object({
    value: z.string(),
  }),
  children: true,
} as const satisfies Component;

const Input = {
  fields: z.object({
    value: z.string(),
  }),
  callbacks: {
    onValueChange: {
      input: z.object({ value: z.string() }),
    },
  },
  children: true,
} as const satisfies Component;

const TextArea = {
  fields: z.object({
    value: z.string(),
    size: z.union([z.enum(["sm", "default", "lg"]), z.number()]),
  }),
  callbacks: {
    onValueChange: {
      input: z.object({ value: z.string() }),
    },
  },
  children: true,
} as const satisfies Component;

export const primitiveTheme = {
  tokens: {
    borderColor: {
      default: "var(--border)",
    },
    background: {
      muted: "var(--muted)",
      surface: "var(--card)",
    },
    textColor: {
      default: "var(--text)",
    },
  },
};

export const components = {
  ...primitives(primitiveTheme),
  Button,
  Tabs,
  TabsList,
  TabsTab,
  TabsPanel,
  Input,
  TextArea,
};

const user = z.object({
  id: z.string(),
  name: z.string(),
});

const customer = z.object({
  id: z.string(),
  name: z.string(),
});

export const views = {
  "/": z.object({
    user,
  }),
  "/customers": z.object({
    customers: z.array(customer),
  }),
  "/customers/detail": z.object({
    customer,
  }),
} satisfies ContextDefinitions;

export const contract = defineContract({
  components,
  views,
  slots: {
    page: { views: ["/"], multiple: true },
    panel: { views: ["/", "/customers", "/customers/detail"] },
    navbar: { views: ["/"] },
  },
  scopes: { user: z.object({ userId: z.string().min(1) }) },
  tools: {
    echo: tool.server().input(z.string()).output(z.string()),
    navigation: {
      openCustomer: tool
        .client()
        .input(z.object({ customerId: z.string() }))
        .output(z.string()),
    },
  },
});
