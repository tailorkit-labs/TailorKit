import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";
import { createActions } from "./actions";
import type { InferActionInput, InferActionOutput, ResolveActionTreeContext } from "./actions";

interface UserContext {
  user: { id: string };
}

const action = createActions();
const userAction = createActions().context<UserContext>();

const noSchemaAction = action.handler(() => ({ ok: true }));
const inputAction = action.input(z.object({ id: z.string() })).handler(({ input }) => input.id);
const outputAction = action
  .output(z.object({ ok: z.literal(true) }))
  .handler(() => ({ ok: true as const }));
const contextAction = userAction.handler(({ context }) => context.user.id);

expectTypeOf<InferActionInput<typeof inputAction>>().toEqualTypeOf<{ id: string }>();
expectTypeOf<InferActionOutput<typeof noSchemaAction>>().toEqualTypeOf<{ ok: boolean }>();
expectTypeOf<InferActionOutput<typeof outputAction>>().toEqualTypeOf<{ ok: true }>();

expectTypeOf<
  ResolveActionTreeContext<{
    noSchemaAction: typeof noSchemaAction;
  }>
>().toEqualTypeOf<never>();

expectTypeOf<
  ResolveActionTreeContext<{
    nested: {
      contextAction: typeof contextAction;
    };
  }>
>().toEqualTypeOf<UserContext>();

action
  .output(z.object({ ok: z.literal(true) }))
  // @ts-expect-error action handlers must match their output schema
  .handler(() => ({ ok: false }));

userAction.handler(({ context }) => {
  expectTypeOf(context).toEqualTypeOf<UserContext>();

  return context.user.id;
});
