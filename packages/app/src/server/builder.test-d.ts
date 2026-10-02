/* oxlint-disable require-await -- These negative type cases intentionally return promises from database handlers. */
import { z } from "zod";
import { tk } from "./builder";
import { defineServer } from "./functions";
import { createApi } from "../client/reference";
import type { Client } from "../client/connection";
import { useAction, useMutation, useQuery } from "../preact";

const functions = {
  read: tk.query
    .input(z.object({ raw: z.string().transform(Number) }))
    .output(z.string().transform(Number))
    .handler(({ input, db }) => {
      const value: number = input.raw;
      // @ts-expect-error Queries cannot write to the database.
      void db.insert;
      return String(value);
    }),
  write: tk.mutation.input(z.object({ value: z.number() })).handler(({ input }) => input.value),
  list: tk.query.handler(({ input }) => {
    const absent: undefined = input;
    void absent;
    // @ts-expect-error No input schema means there are no input properties.
    void input.value;
    return [1, 2];
  }),
  saveWithoutSchemas: tk.mutation.handler(({ input }) => {
    const absent: undefined = input;
    void absent;
    return { saved: true };
  }),
  actionWithoutSchemas: tk.action.handler(({ input }) => {
    const absent: undefined = input;
    void absent;
    return Promise.resolve({ completed: true });
  }),
};
const save = tk.action
  .functions(functions)
  .input(z.object({ value: z.number() }))
  .output(z.number())
  .handler(async (context) => {
    const read: number = await context.queries.read({ raw: "4" });
    // @ts-expect-error Actions have no direct database handle.
    void context.db;
    // @ts-expect-error Action query arguments use schema inputs.
    context.queries.read({ raw: 4 });
    const rows: number[] = await context.queries.list();
    const saved: { saved: boolean } = await context.mutations.saveWithoutSchemas();
    void rows;
    void saved;
    // @ts-expect-error No-input queries do not accept objects.
    context.queries.list({});
    return context.mutations.write({ value: context.input.value + read });
  });
const app = defineServer({ ...functions, save });
type Api = typeof app.functions;
const refs = createApi<Api>();
declare const client: Client;
const result: Promise<number> = client.query(refs.read, { raw: "3" });
void result;
const inferredRows: Promise<number[]> = client.query(refs.list);
const savedWithoutInput: Promise<{ saved: boolean }> = client.mutate(refs.saveWithoutSchemas);
const completedWithoutInput: Promise<{ completed: boolean }> = client.action(
  refs.actionWithoutSchemas,
);
void inferredRows;
void savedWithoutInput;
void completedWithoutInput;
// @ts-expect-error No-input imperative queries do not accept values.
client.query(refs.list, {});
// @ts-expect-error Required imperative query inputs cannot be omitted.
client.query(refs.read);
// @ts-expect-error Imperative inputs are inferred from the reference, not widened by arguments.
client.query(refs.read, { raw: 3 });
// @ts-expect-error Async database handlers cannot escape the synchronous transaction.
tk.mutation.handler(async () => 1);
// @ts-expect-error Async queries are not allowed.
tk.query.handler(async () => 1);
// @ts-expect-error Output schemas constrain handler results before output transformations.
tk.query.output(z.number()).handler(() => "wrong");
// @ts-expect-error Only actions can call other functions.
tk.query.functions(functions);
const query = useQuery(refs.read, { raw: "3" });
const data: number | undefined = query.data;
void data;
useQuery(refs.list);
const rows: number[] | undefined = useQuery(refs.list).data;
void rows;
// @ts-expect-error No-input queries do not accept objects.
useQuery(refs.list, {});
const inferredSave: Promise<{ saved: boolean }> = useMutation(
  refs.saveWithoutSchemas,
).mutateAsync();
const inferredAction: Promise<{ completed: boolean }> = useAction(
  refs.actionWithoutSchemas,
).executeAsync();
void inferredSave;
void inferredAction;
// @ts-expect-error No-input mutations do not accept objects.
useMutation(refs.saveWithoutSchemas).mutate({});
// @ts-expect-error No-input actions do not accept objects.
useAction(refs.actionWithoutSchemas).execute({});
// @ts-expect-error Output schemas also constrain async action results.
tk.action.output(z.number()).handler(async () => "wrong");
// @ts-expect-error Required query inputs cannot be omitted.
useQuery(refs.read);
// @ts-expect-error Mutation functions cannot be subscribed as queries.
useQuery(refs.write, { value: 1 });
const write = useMutation(refs.write);
write.mutate({ value: 1 });
// @ts-expect-error Mutation arguments retain schema input types.
write.mutate({ value: "1" });
const action = useAction(refs.save);
const saved: Promise<number> = action.executeAsync({ value: 1 });
void saved;
// @ts-expect-error Actions cannot be called with the mutation hook.
useMutation(refs.save);
