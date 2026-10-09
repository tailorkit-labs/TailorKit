import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";
import { action, defineContract } from "./contract";
import type { InferActionInput, InferActionOutput } from "./actions";
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
