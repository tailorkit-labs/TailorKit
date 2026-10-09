import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import * as v from "valibot";
import { action, defineContract } from "../schema/contract";
import { createServer } from "./contract";
import { createTailorKitClient } from "./client";

const contract = defineContract({
  components: {},
  scopes: { user: z.object({ userId: z.string() }) },
  actions: {
    customers: {
      rename: action()
        .input(z.object({ name: z.string().trim().min(1) }))
        .output(z.object({ name: z.string() })),
    },
  },
});

it("binds contract action schemas to server handlers and validates both input and output", async () => {
  const handler = vi.fn(
    ({ input, context }: { input: { name: string }; context: { userId: string } }) => ({
      name: `${context.userId}:${input.name}`,
      extra: true,
    }),
  );
  const server = createServer({
    contract,
    authenticate: () => ({ scopes: { user: { userId: "u1" } }, actionContext: { userId: "u1" } }),
    actions: { customers: { rename: handler } },
  });
  const client = createTailorKitClient({
    url: "https://host.test/api/tailorkit",
    fetch: async (input, init) =>
      server.handler(new Request(new URL(String(input), "https://host.test"), init)),
  });
  const result = await client.actions.execute({
    path: "customers.rename",
    input: { name: "  Alice  ", extra: true },
  });
  expect(handler).toHaveBeenCalledExactlyOnceWith({
    input: { name: "Alice" },
    context: { userId: "u1" },
  });
  expect(result).toEqual({ name: "u1:Alice" });
  await expect(
    client.actions.execute({ path: "customers.rename", input: { name: "" } }),
  ).rejects.toThrow("Invalid TailorKit payload");
});

it("keeps metadata for app type generation with action and scope schemas", async () => {
  const server = createServer({
    contract,
    actions: { customers: { rename: ({ input }) => input } },
  });
  const response = await server.handler(new Request("https://host.test/api/tailorkit/meta"), {
    authenticate: () => null,
  });
  const meta = await response.json();
  expect(meta.schema.actions.customers.rename.input.properties.name.type).toBe("string");
  expect(meta.schema.scopes.user.properties.userId.type).toBe("string");
  expect(meta.assetsBaseUrl).toBeNull();
});

it("requires complete implementations and rejects undeclared actions at runtime", () => {
  expect(() =>
    createServer({
      contract,
      // @ts-expect-error all declared actions need implementations
      actions: { customers: {} },
    }),
  ).toThrow('Missing implementation for action "customers.rename"');
  expect(() =>
    createServer({
      contract,
      actions: {
        customers: { rename: ({ input }) => input },
        // @ts-expect-error implementations must be declared
        extra: () => {},
      },
    }),
  ).toThrow('Action "extra" is not declared');
});

it("supports contracts without actions and request-specific authentication", async () => {
  const server = createServer({
    contract: defineContract({ scopes: { user: z.object({ userId: z.string() }) } }),
  });
  expect(() => server.handler(new Request("https://host.test/api/tailorkit/meta"))).toThrow(
    "Supply authenticate",
  );
  const response = await server.handler(new Request("https://host.test/api/tailorkit/meta"), {
    authenticate: () => null,
  });
  expect(response.ok).toBe(true);
});

it("allows JSON Schema conversion to stay on the server for native Standard Schemas", async () => {
  const contextSchema = v.object({ name: v.string() });
  const contract = defineContract({
    views: { "/": contextSchema },
    scopes: { user: v.object({ userId: v.string() }) },
  });
  const server = createServer({ contract, authenticate: () => null });
  await expect(server.handler(new Request("https://host.test/api/tailorkit/meta"))).rejects.toThrow(
    "Supply a schemaSerializer",
  );
  const jsonSchema = {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  };
  const serializer = vi.fn(() => jsonSchema);
  const configuredServer = createServer({
    contract,
    schemaSerializer: serializer,
    authenticate: () => null,
  });
  const response = await configuredServer.handler(
    new Request("https://host.test/api/tailorkit/meta"),
  );
  expect((await response.json()).schema.views["/"].context).toEqual(jsonSchema);
  expect(serializer).toHaveBeenCalledWith(contextSchema);
  expect(serializer).toHaveBeenCalledTimes(2);
});
