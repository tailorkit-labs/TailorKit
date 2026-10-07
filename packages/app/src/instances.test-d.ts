import { z } from "zod";
import { createView } from "./views";
import { defineServer, tk } from "./server";

const server = defineServer({
  reports: {
    list: tk.query
      .input(z.object({ userId: z.string() }))
      .handler(({ input }) => [{ id: input.userId }]),
    count: tk.query.handler(() => 1),
    write: tk.mutation.handler(() => null),
    fetch: tk.action.handler(() => Promise.resolve(null)),
  },
});
type ServerFunctions = typeof server.functions;
declare module "./views" {
  interface TailorKitServerFunctions extends ServerFunctions {}
}

createView({
  slot: "page",
  view: "/users",
  component: () => null,
  instances: {
    dataSchema: z.object({ reportId: z.string() }),
    resolve: async ({ context, queries, identity, signal, ...other }) => {
      const user: string = context.userId;
      const count: number = await queries.reports.count();
      const reports: { id: string }[] = await queries.reports.list({ userId: user });
      const installationId: string = identity.installationId;
      const abort: boolean = signal.aborted;
      void count;
      void installationId;
      void abort;
      // @ts-expect-error Query inputs are inferred from the server definition.
      queries.reports.list({ userId: 123 });
      // @ts-expect-error Required query inputs cannot be omitted.
      queries.reports.list();
      // @ts-expect-error Mutation functions are not exposed.
      queries.reports.write();
      // @ts-expect-error Action functions are not exposed.
      queries.reports.fetch();
      // @ts-expect-error Resolver context has no arbitrary input.
      void other.input;
      // @ts-expect-error Resolver context has no mutation capability.
      void other.mutations;
      return reports.map((report) => ({
        key: report.id,
        metadata: { title: "Report" },
        data: { reportId: report.id },
      }));
    },
  },
});
createView({
  slot: "page",
  view: "/",
  component: () => null,
  instances: {
    dataSchema: z.object({ reportId: z.string() }),
    // @ts-expect-error Each instance's data must match dataSchema.
    resolve: () => [{ key: "overview", metadata: {}, data: { reportId: 123 } }],
  },
});

const instanceView = createView({
  slot: "page",
  view: "/",
  component: () => null,
  instances: {
    dataSchema: z.object({ count: z.string().transform(Number) }),
    resolve: () => [{ key: "summary", metadata: {}, data: { count: "42" } }],
  },
});
const selected = instanceView.useInstance();
const selectedKey: string = selected.key;
const parsedCount: number = selected.data.count;
void selectedKey;
void parsedCount;
// @ts-expect-error instance data is the parsed schema output
const _rawCount: string = selected.data.count;
// @ts-expect-error instance data fields are inferred from the schema
const _missing = selected.data.missing;
