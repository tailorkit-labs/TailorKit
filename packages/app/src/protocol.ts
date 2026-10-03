import { oc, type } from "@orpc/contract";
import type { ContractRouterClient } from "@orpc/contract";
import { z } from "zod";

export const invocationSchema = z.strictObject({
  name: z
    .string()
    .max(512)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}(?:\.[a-zA-Z][a-zA-Z0-9_]{0,63})*$/u),
  args: z.unknown().optional(),
});
export type Invocation = z.infer<typeof invocationSchema>;
export type MutationInvocation = Invocation & { requestId: string };

const procedure = oc.errors({
  BAD_REQUEST: {},
  UNAUTHORIZED: {},
  FORBIDDEN: {},
  NOT_FOUND: {},
  CONFLICT: {},
  INCOMPATIBLE_VERSION: {},
  UNAVAILABLE: {},
  INTERNAL_SERVER_ERROR: {},
});

/** Public wire contract; implementations and clients both depend on this definition. */
export const appContract = {
  queries: procedure.input(invocationSchema).output(type<unknown>()),
  mutations: procedure
    .input(invocationSchema.extend({ requestId: z.uuid() }))
    .output(type<unknown>()),
  actions: procedure.input(invocationSchema).output(type<unknown>()),
  // A pass-through type schema preserves the private hibernation iterator instance.
  subscribe: procedure.input(invocationSchema).output(type<AsyncIterableIterator<unknown>>()),
};
export type PlatformClient = ContractRouterClient<typeof appContract>;
export type SubscriptionClient = Pick<PlatformClient, "subscribe">;

/** Drizzle-generated SQL exported by application bundles. */
export interface AppMigration {
  id: string;
  hash: string;
  statements: string[];
}
