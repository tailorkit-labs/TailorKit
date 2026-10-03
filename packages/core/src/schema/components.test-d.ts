import { expectTypeOf } from "vite-plus/test";
import type { z } from "zod";
import type { Component, ComponentProps, NoComponentFieldCallbackConflicts } from "./components";

interface Button {
  fields: z.ZodObject<{
    variant: z.ZodEnum<{ default: "default"; secondary: "secondary" }>;
  }>;
  callbacks: {
    onClick: Record<never, never>;
  };
  children: true;
}

expectTypeOf<ComponentProps<Button>>().toMatchTypeOf<{
  variant: "default" | "secondary";
  onClick: () => void;
}>();

expectTypeOf<Button["children"]>().toEqualTypeOf<true>();

const annotatedComponent: Component = {
  callbacks: {
    onValueChange: {
      input: {} as z.ZodObject<{ value: z.ZodString }>,
    },
  },
};
void annotatedComponent;

expectTypeOf<
  NoComponentFieldCallbackConflicts<{
    Button: Button;
  }>
>().toMatchTypeOf<{
  Button: unknown;
}>();

expectTypeOf<
  NoComponentFieldCallbackConflicts<{
    Button: {
      fields: z.ZodObject<{ onClick: z.ZodString }>;
      callbacks: { onClick: Record<never, never> };
    };
  }>
>().toMatchTypeOf<{
  Button: {
    readonly __tailorkit_error__: "Field and callback keys must be unique. Conflicting key: onClick";
  };
}>();
