import type { StandardSchemaV1 } from "@standard-schema/spec";
import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";
import { createTailorKitServer } from "./handler";
import type { TailorKitHandlerOptions, TailorKitHostContext } from "./types";

interface UserContext {
  user: { id: string };
}

expectTypeOf<TailorKitHostContext<UserContext, { org: { orgId: string } }>>().toMatchTypeOf<{
  actionContext: UserContext;
  scopes: { org: { orgId: string } };
}>();

expectTypeOf<TailorKitHostContext<never>>().toMatchTypeOf<{
  actionContext?: never;
  scopes: Record<string, Record<string, unknown>>;
}>();

expectTypeOf<TailorKitHandlerOptions<UserContext, { org: { orgId: string } }>>().toMatchTypeOf<{
  authenticate: (ctx: {
    request: Request;
  }) =>
    | TailorKitHostContext<UserContext, { org: { orgId: string } }>
    | null
    | Promise<TailorKitHostContext<UserContext, { org: { orgId: string } }> | null>;
}>();

const contextlessHandlerContext: TailorKitHostContext<never> = {
  scopes: { org: { orgId: "org_1" } },
};
void contextlessHandlerContext;

const invalidContextlessHandlerContext: TailorKitHostContext<never> = {
  // @ts-expect-error actionContext cannot be provided when no action context is declared
  actionContext: {},
  scopes: { org: { orgId: "org_1" } },
};
void invalidContextlessHandlerContext;

createTailorKitServer({
  scopes: { account: z.object({ accountId: z.string() }) },
  components: {},
  contexts: { "/": z.object({}), "/users": z.object({}) },
  slots: { navbar: { views: ["/"] }, panel: { views: ["/users"] } },
});
createTailorKitServer({
  scopes: { account: z.object({ accountId: z.string() }) },
  components: {},
  contexts: { "/": z.object({}) },
  // @ts-expect-error A slot cannot reference an undeclared global view.
  slots: { panel: { views: ["/missing"] } },
});

const namedScopes = {
  org: z.object({ orgId: z.string() }),
  userOrg: z.object({ orgId: z.string(), userId: z.string() }),
};
const scopedServer = createTailorKitServer({ scopes: namedScopes, components: {} });
scopedServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({
    scopes: {
      org: { orgId: "org_1" },
      userOrg: { orgId: "org_1", userId: "user_1" },
    },
  }),
});
scopedServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({ scopes: { org: { orgId: "org_1" } } }),
});
scopedServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({
    scopes: {
      // @ts-expect-error org is inferred from its schema and requires orgId
      org: {},
    },
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
  scopes: { account: nonJsonSchemaScope },
  components: {},
});
standardOnlyServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({ scopes: { account: { accountId: "acct_1" } } }),
});
