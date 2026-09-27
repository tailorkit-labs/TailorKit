import { createTailorKitServer } from "./handler";
import { z } from "zod";
import { expectTypeOf } from "vite-plus/test";
import type { TailorKitHandlerOptions, TailorKitHostContext } from "./types";

interface UserContext {
  user: { id: string };
}

expectTypeOf<TailorKitHostContext<UserContext>>().toMatchTypeOf<{
  actionContext: UserContext;
  scopeId: string;
}>();

expectTypeOf<TailorKitHostContext<never>>().toMatchTypeOf<{
  actionContext?: never;
  scopeId: string;
}>();

expectTypeOf<TailorKitHandlerOptions<UserContext>>().toMatchTypeOf<{
  authenticate: (ctx: {
    request: Request;
  }) =>
    | TailorKitHostContext<UserContext>
    | null
    | Promise<TailorKitHostContext<UserContext> | null>;
}>();

const contextlessHandlerContext: TailorKitHostContext<never> = {
  scopeId: "user:user_1",
};
void contextlessHandlerContext;

const invalidContextlessHandlerContext: TailorKitHostContext<never> = {
  // @ts-expect-error actionContext cannot be provided when no action context is declared
  actionContext: {},
  scopeId: "user:user_1",
};
void invalidContextlessHandlerContext;

createTailorKitServer({
  components: {},
  contexts: { "/": z.object({}), "/users": z.object({}) },
  slots: { navbar: { views: ["/"] }, panel: { views: ["/users"] } },
});
createTailorKitServer({
  components: {},
  contexts: { "/": z.object({}) },
  // @ts-expect-error A slot cannot reference an undeclared global view.
  slots: { panel: { views: ["/missing"] } },
});
