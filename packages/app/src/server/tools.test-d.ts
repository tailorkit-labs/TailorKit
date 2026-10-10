import type {} from "../client";
import { action } from "./functions";
import { z } from "zod";
import { expectTypeOf } from "vite-plus/test";
declare module "../client" {
  interface TailorKitServerTools {
    billing: { read(input: { accountId: string }): Promise<number> };
  }
}
action({
  args: z.object({ accountId: z.string() }),
  handler: async (ctx) => {
    expectTypeOf(ctx.tools.billing.read(ctx.args)).toEqualTypeOf<Promise<number>>();
    expectTypeOf(ctx.identity.subjectId).toEqualTypeOf<string | undefined>();
    return ctx.tools.billing.read(ctx.args);
  },
});
