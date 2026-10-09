import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";
import * as v from "valibot";
import { toJsonSchema } from "@valibot/to-json-schema";
import { action, defineContract } from "./contract";
import type { ActionDefinition, InferActionInput, InferActionOutput } from "./actions";
import type { ActionImplementations } from "../server/contract";
import type { SchemaSerializer } from "./shared";
import { createServer } from "../server/contract";

const contract = defineContract({
  views: { "/": z.object({ userId: z.string() }) },
  slots: { page: { views: ["/"], multiple: true } },
  scopes: { user: z.object({ userId: z.string() }) },
  actions: {
    rename: action()
      .input(z.object({ name: z.string() }))
      .output(z.object({ name: z.string() })),
  },
});

const valibotSerializer: SchemaSerializer = toJsonSchema;
createServer({
  contract: defineContract({
    views: { "/": v.object({ userId: v.string() }) },
    scopes: { user: v.object({ userId: v.string() }) },
  }),
  schemaSerializer: toJsonSchema,
});
void valibotSerializer;
expectTypeOf(contract.slots.page.multiple).toEqualTypeOf<true>();
createServer({
  contract,
  authenticate: ({ request }: { request: Request }) => ({
    scopes: { user: { userId: "u1" } },
    actionContext: { privateUserId: request.headers.get("user") ?? "u1" },
  }),
  actions: {
    rename: ({ input, context }) => {
      expectTypeOf(input).toEqualTypeOf<{ name: string }>();
      expectTypeOf(context).toEqualTypeOf<{ privateUserId: string }>();
      return input;
    },
  },
});
// @ts-expect-error declared actions require implementations
createServer({ contract });
createServer({
  contract,
  actions: {
    // @ts-expect-error output must match its declared schema
    rename: () => ({ name: 123 }),
  },
});
defineContract({
  views: {
    "/": z.object({ userId: z.string() }),
    // @ts-expect-error descendants cannot redeclare ancestor fields
    "/detail": z.object({ userId: z.string() }),
  },
});
defineContract({
  components: {
    // @ts-expect-error fields cannot conflict with callback names
    Button: { fields: z.object({ onClick: z.string() }), callbacks: { onClick: {} } },
  },
});

expectTypeOf<InferActionInput<typeof contract.actions.rename>>().toEqualTypeOf<{ name: string }>();
expectTypeOf<InferActionOutput<typeof contract.actions.rename>>().toEqualTypeOf<{ name: string }>();

const emptyAction = action();
const inputOnlyAction = action().input(z.string());
const outputOnlyAction = action().output(z.number());
expectTypeOf<InferActionInput<typeof emptyAction>>().toEqualTypeOf<undefined>();
expectTypeOf<InferActionOutput<typeof emptyAction>>().toEqualTypeOf<void>();
expectTypeOf<InferActionInput<typeof inputOnlyAction>>().toEqualTypeOf<string>();
expectTypeOf<InferActionOutput<typeof inputOnlyAction>>().toEqualTypeOf<void>();
expectTypeOf<InferActionInput<typeof outputOnlyAction>>().toEqualTypeOf<undefined>();
expectTypeOf<InferActionOutput<typeof outputOnlyAction>>().toEqualTypeOf<number>();
expectTypeOf<InferActionInput<ActionDefinition<undefined, undefined>>>().toEqualTypeOf<undefined>();
expectTypeOf<InferActionOutput<ActionDefinition<undefined, undefined>>>().toEqualTypeOf<void>();
expectTypeOf<
  InferActionInput<ActionDefinition<z.ZodString, z.ZodNumber>>
>().toEqualTypeOf<string>();
expectTypeOf<
  InferActionOutput<ActionDefinition<z.ZodString, z.ZodNumber>>
>().toEqualTypeOf<number>();

const noOutputContract = defineContract({ actions: { sync: emptyAction, async: inputOnlyAction } });
type NoOutputImplementations = ActionImplementations<typeof noOutputContract.actions>;
expectTypeOf<ReturnType<NoOutputImplementations["sync"]>>().toEqualTypeOf<void | Promise<void>>();
expectTypeOf<ReturnType<NoOutputImplementations["async"]>>().toEqualTypeOf<void | Promise<void>>();
createServer({
  contract: noOutputContract,
  actions: {
    sync: ({ input }) => {
      expectTypeOf(input).toEqualTypeOf<undefined>();
    },
    async: async ({ input }) => {
      expectTypeOf(input).toEqualTypeOf<string>();
    },
  },
});
createServer({
  contract: noOutputContract,
  actions: {
    sync: () => {},
    // @ts-expect-error an async handler cannot expose output absent from the contract
    async: async () => "undeclared output",
  },
});
