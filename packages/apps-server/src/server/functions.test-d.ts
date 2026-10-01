import { z } from "zod";
import { action, defineApp, mutation, query } from "./functions";
import type { Client } from "../client/connection";
import type { References } from "../client/reference";

const functions = {
  read: query({
    args: z.object({ raw: z.string().transform(Number) }),
    handler: ({ args }) => args.raw,
  }),
  write: mutation({
    args: z.object({ value: z.number() }),
    handler: ({ args }) => args.value,
  }),
};

const app = defineApp({
  ...functions,
  save: action({
    functions,
    args: z.object({ value: z.number() }),
    async handler(ctx) {
      const read: number = await ctx.queries.read({ raw: "4" });
      const written: number = await ctx.mutations.write({ value: ctx.args.value + read });
      // @ts-expect-error Queries cannot appear in the mutation namespace.
      ctx.mutations.read({ raw: "4" });
      // @ts-expect-error Mutations cannot appear in the query namespace.
      ctx.queries.write({ value: 1 });
      // @ts-expect-error Call arguments use schema inputs, before transformations.
      ctx.queries.read({ raw: 4 });
      // @ts-expect-error Mutation arguments retain their inferred schema types.
      ctx.mutations.write({ value: "1" });
      // @ts-expect-error Unknown functions are not callable.
      ctx.mutations.missing({});
      // @ts-expect-error Actions have no direct database access.
      void ctx.db;
      return written;
    },
  }),
});

declare const client: Client;
declare const references: References<typeof app.functions>;
const result: Promise<number> = client.action(references.save, { value: 1 });
void result;
