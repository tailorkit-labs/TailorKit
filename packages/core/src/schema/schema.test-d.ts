import { createTailorKitSchema } from "./schema";
import type { ComponentProps } from "./schema";
import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";

createTailorKitSchema({
  components: {
    Button: {
      fields: z.object({
        variant: z.enum(["default", "secondary"]),
      }),
      children: true,
    },
  },
});

createTailorKitSchema({
  components: {},
  views: {
    "/pages": z.object({ userId: z.string() }),
    "/pages/detail": z.object({ pageId: z.string() }),
  },
});

const tailor = createTailorKitSchema({
  components: {
    Button: {
      fields: z.object({
        variant: z.enum(["default", "secondary"]),
      }),
      children: true,
    },
  },
  views: {
    "/": z.object({}),
    "/customers/:customerId": z.object({ customerId: z.string() }),
  },
});

const component = tailor.components.Button;
const context = tailor.views["/customers/:customerId"];
void component;
void context;

const buttonProps: ComponentProps<typeof tailor.components.Button> = { variant: "default" };
void buttonProps;

expectTypeOf<ComponentProps<typeof tailor.components.Button>>().toMatchTypeOf<{
  variant: "default" | "secondary";
}>();
expectTypeOf<typeof tailor.components.Button.children>().toEqualTypeOf<true>();
expectTypeOf<typeof context>().toEqualTypeOf<z.ZodObject<{ customerId: z.ZodString }>>();
const callbacks = createTailorKitSchema({
  components: {
    Dialog: {
      callbacks: {
        onSave: {
          input: z.object({ title: z.string(), version: z.number() }),
          output: z.object({ saved: z.boolean() }),
        },
        onClose: {},
        onLoad: {
          async: true,
          output: z.object({ ready: z.literal(true) }),
        },
      },
    },
  },
});

const dialogProps: ComponentProps<typeof callbacks.components.Dialog> = {
  onSave: (input) => {
    expectTypeOf(input).toEqualTypeOf<{ title: string; version: number }>();
    return { saved: true };
  },
  onClose: () => {},
  onLoad: () => Promise.resolve({ ready: true as const }),
};
void dialogProps;
expectTypeOf<ComponentProps<typeof callbacks.components.Dialog>>().toMatchTypeOf<{
  onSave: (input: { title: string; version: number }) => { saved: boolean };
  onClose: () => void;
  onLoad: () => Promise<{ ready: true }>;
}>();

createTailorKitSchema({
  components: {
    Button: {
      fields: z.object({
        variant: z.enum(["default", "secondary"]),
      }),
      callbacks: {
        onClick: {},
      },
      children: true,
    },
  },
});

createTailorKitSchema({
  components: {
    // @ts-expect-error field and callback keys must still conflict when explicitly duplicated
    Button: {
      fields: z.object({
        variant: z.enum(["default", "secondary"]),
      }),
      callbacks: {
        variant: {},
      },
    },
  },
});

createTailorKitSchema({
  components: {},
  views: {
    "/": z.object({ workspaceId: z.string() }),
    // @ts-expect-error Each field has one owning view.
    "/users/detail": z.object({ workspaceId: z.string() }),
  },
});

createTailorKitSchema({
  components: {},
  views: { "/": z.object({}), "/users": z.object({}) },
  slots: { navbar: { views: ["/"] }, panel: { views: ["/users"] } },
});
createTailorKitSchema({
  components: {},
  views: { "/": z.object({}) },
  // @ts-expect-error Slot lists can only reference declared views.
  slots: { panel: { views: ["/missing"] } },
});

createTailorKitSchema({
  components: {},
  views: {
    // @ts-expect-error Context composition requires named fields.
    "/number": z.number(),
    // @ts-expect-error Strings must be wrapped in an object field.
    "/string": z.string(),
    // @ts-expect-error Arrays must be wrapped in an object field.
    "/array": z.array(z.string()),
    // @ts-expect-error Every member of a context union must be an object.
    "/union": z.union([z.object({ id: z.string() }), z.number()]),
    // @ts-expect-error Null is not an object context.
    "/null": z.object({ id: z.string() }).nullable(),
    "/optional": z.object({ id: z.string() }).optional(),
    "/empty": z.object({}),
  },
});
