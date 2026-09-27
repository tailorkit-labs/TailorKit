import { createTailorKitServer } from "./handler";
import { z } from "zod";
import { expectTypeOf } from "vite-plus/test";
import type { TailorKitHandlerOptions, TailorKitHostContext } from "./types";
import type { StandardSchemaV1 } from "@standard-schema/spec";

interface UserContext {
  user: { id: string };
}

expectTypeOf<TailorKitHostContext<UserContext, { orgId: string }>>().toMatchTypeOf<{
  actionContext: UserContext;
  scope: { orgId: string };
}>();

expectTypeOf<TailorKitHostContext<never>>().toMatchTypeOf<{
  actionContext?: never;
  scope: Record<string, string>;
}>();

expectTypeOf<TailorKitHandlerOptions<UserContext, { orgId: string }>>().toMatchTypeOf<{
  authenticate: (ctx: {
    request: Request;
  }) =>
    | TailorKitHostContext<UserContext, { orgId: string }>
    | null
    | Promise<TailorKitHostContext<UserContext, { orgId: string }> | null>;
}>();

const contextlessHandlerContext: TailorKitHostContext<never> = {
  scope: { userId: "user_1" },
};
void contextlessHandlerContext;

const invalidContextlessHandlerContext: TailorKitHostContext<never> = {
  // @ts-expect-error actionContext cannot be provided when no action context is declared
  actionContext: {},
  scope: { userId: "user_1" },
};
void invalidContextlessHandlerContext;

createTailorKitServer({
  scopeSchema: z.object({ accountId: z.string() }),
  components: {},
  contexts: { "/": z.object({}), "/users": z.object({}) },
  slots: { navbar: { views: ["/"] }, panel: { views: ["/users"] } },
});
createTailorKitServer({
  scopeSchema: z.object({ accountId: z.string() }),
  components: {},
  contexts: { "/": z.object({}) },
  // @ts-expect-error A slot cannot reference an undeclared global view.
  slots: { panel: { views: ["/missing"] } },
});

const scopeSchema = z.object({ orgId: z.string(), userId: z.string() });
const scopedServer = createTailorKitServer({ scopeSchema, components: {} });
scopedServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({ scope: { orgId: "org_1", userId: "user_1" } }),
});
scopedServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({
    // @ts-expect-error scope is inferred from scopeSchema input and requires both fields
    scope: { orgId: "org_1" },
  }),
});

const nonJsonSchemaScope = {
  "~standard": {
    version: 1 as const,
    vendor: "core-type-test",
    types: {} as StandardSchemaV1.Types<{ accountId: string }, { accountId: string }>,
    validate: (value: unknown) => ({ value: value as { accountId: string } }),
  },
} satisfies StandardSchemaV1<{ accountId: string }, { accountId: string }>;

const standardOnlyServer = createTailorKitServer({
  scopeSchema: nonJsonSchemaScope,
  components: {},
});
standardOnlyServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({ scope: { accountId: "acct_1" } }),
});
