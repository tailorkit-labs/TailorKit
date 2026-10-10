import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";
import { createTailorKitServer } from "./handler";
import type { TailorKitServerOptions } from "./types";
import { expectTypeOf } from "vite-plus/test";
import type { TailorKitHostContext } from "./types";
expectTypeOf<TailorKitHostContext<{ org: { orgId: string } }>>().toEqualTypeOf<{
  scopes: { org: { orgId: string } };
  subjectId?: string;
}>();

createTailorKitServer({
  scopes: { account: z.object({ accountId: z.string() }) },
  components: {},
  views: { "/": z.object({}), "/users": z.object({}) },
  slots: { navbar: { views: ["/"] }, panel: { views: ["/users"] } },
});
createTailorKitServer({
  scopes: { account: z.object({ accountId: z.string() }) },
  components: {},
  views: { "/": z.object({}) },
  // @ts-expect-error A slot cannot reference an undeclared global view.
  slots: { panel: { views: ["/missing"] } },
});

const namedScopes = {
  org: z.object({ orgId: z.string() }),
  userOrg: z.object({ orgId: z.string(), userId: z.string() }),
};
const scopedServer = createTailorKitServer({ scopes: namedScopes, components: {} });
const explicitlyTypedOptions: TailorKitServerOptions<
  Record<never, never>,
  Record<never, never>,
  Record<never, never>,
  typeof namedScopes
> = { scopes: namedScopes, components: {} };
const explicitlyTypedServer = createTailorKitServer(explicitlyTypedOptions);
explicitlyTypedServer.handler(new Request("https://example.com/api/tailorkit/apps"), {
  authenticate: () => ({
    scopes: {
      // @ts-expect-error explicit options retain the org schema's required orgId
      org: {},
    },
  }),
});
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
  // @ts-expect-error authenticate must provide at least one declared scope
  authenticate: () => ({ scopes: {} }),
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
