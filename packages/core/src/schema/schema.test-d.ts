import { createActions, createTailorKitSchema } from "./schema";
import type { ComponentProps, InferActionInput, InferActionOutput } from "./schema";
import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";

interface User {
  id: string;
}
interface Org {
  id: string;
}

const untypedAction = createActions();

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
  contexts: {
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
  contexts: {
    "/": z.object({}),
    "/customers/:customerId": z.object({ customerId: z.string() }),
  },
  actions: {
    noSchemas: untypedAction.handler(() => ({ ok: true })),
    withInput: untypedAction.input(z.object({ id: z.string() })).handler(({ input }) => input.id),
    withOutput: untypedAction
      .output(z.object({ ok: z.literal(true) }))
      .handler(() => ({ ok: true as const })),
    invalidOutput: untypedAction
      .output(z.object({ ok: z.literal(true) }))
      // @ts-expect-error action handlers must return values matching their output schema
      .handler(() => ({ ok: false })),
  },
});

const component = tailor.components.Button;
const context = tailor.contexts["/customers/:customerId"];
const noSchemaAction = tailor.actions.noSchemas;
void component;
void context;
void noSchemaAction;

const buttonProps: ComponentProps<typeof tailor.components.Button> = { variant: "default" };
void buttonProps;

expectTypeOf<ComponentProps<typeof tailor.components.Button>>().toMatchTypeOf<{
  variant: "default" | "secondary";
}>();
expectTypeOf<typeof tailor.components.Button.children>().toEqualTypeOf<true>();
expectTypeOf<typeof context>().toEqualTypeOf<z.ZodObject<{ customerId: z.ZodString }>>();
expectTypeOf<InferActionInput<typeof tailor.actions.withInput>>().toEqualTypeOf<{ id: string }>();
expectTypeOf<InferActionOutput<typeof tailor.actions.withOutput>>().toEqualTypeOf<{ ok: true }>();
expectTypeOf<InferActionOutput<typeof noSchemaAction>>().toEqualTypeOf<{ ok: boolean }>();

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

const userAction = createActions().context<{ user: User }>();
const matchingUserAction = createActions().context<{ user: User }>();
const orgAction = createActions().context<{ org: Org }>();

createTailorKitSchema({
  components: {},
  actions: {
    getUser: userAction.handler(({ context }) => context.user.id),
    nested: {
      getNestedUser: matchingUserAction.handler(({ context }) => context.user.id),
    },
  },
});

createTailorKitSchema({
  components: {},
  // @ts-expect-error all actions in one TailorKit instance must use the same context type
  actions: {
    getUser: userAction.handler(({ context }) => context.user.id),
    nested: {
      getOrg: orgAction.handler(({ context }) => context.org.id),
    },
  },
});

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
  contexts: {
    "/": z.object({ workspaceId: z.string() }),
    // @ts-expect-error Each field has one owning view.
    "/users/detail": z.object({ workspaceId: z.string() }),
  },
});

createTailorKitSchema({
  components: {},
  contexts: { "/": z.object({}), "/users": z.object({}) },
  slots: { navbar: { views: ["/"] }, panel: { views: ["/users"] } },
});
createTailorKitSchema({
  components: {},
  contexts: { "/": z.object({}) },
  // @ts-expect-error Slot lists can only reference declared views.
  slots: { panel: { views: ["/missing"] } },
});

createTailorKitSchema({
  components: {},
  contexts: {
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
