import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import * as v from "valibot";
import { toJsonSchema } from "@valibot/to-json-schema";
import { primitives } from "../primitives/valibot";
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
  expect(serializer).toHaveBeenCalledWith(contextSchema, {
    target: "draft-2020-12",
    typeMode: "output",
  });
  expect(serializer).toHaveBeenCalledTimes(2);
});

it("accepts Valibot's JSON Schema converter directly across the contract", async () => {
  const contract = defineContract({
    components: {
      ...primitives(),
      Button: {
        fields: v.object({ label: v.string() }),
        callbacks: {
          onClick: { input: v.object({ id: v.string() }), output: v.boolean() },
        },
      },
    },
    views: { "/": v.object({ name: v.string() }) },
    scopes: { user: v.object({ userId: v.string() }) },
    actions: {
      nested: {
        increment: action()
          .input(v.pipe(v.string(), v.transform(Number), v.number()))
          .output(v.number()),
      },
    },
  });
  const server = createServer({
    contract,
    schemaSerializer: toJsonSchema,
    actions: { nested: { increment: ({ input }) => input + 1 } },
    authenticate: () => ({ scopes: { user: { userId: "u1" } } }),
  });
  const request = (path: string) =>
    server.handler(new Request(`https://host.test/api/tailorkit/${path}`));
  const schema = await (await request("schema")).json();
  const meta = await (await request("meta")).json();
  expect(meta.schema).toEqual(schema);
  expect(schema.components.Button.fields.properties.label.type).toBe("string");
  expect(schema.components.Button.callbacks.onClick.input.properties.id.type).toBe("string");
  expect(schema.components.Button.callbacks.onClick.output.type).toBe("boolean");
  expect(schema.views["/"].context.properties.name.type).toBe("string");
  expect(schema.scopes.user.properties.userId.type).toBe("string");
  expect(schema.actions.nested.increment.input).toMatchObject({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "number",
  });
  expect(schema.actions.nested.increment.output.type).toBe("number");
  expect(JSON.stringify(schema)).not.toContain("~standard");
  expect(contract.views["/"]["~standard"]).not.toHaveProperty("jsonSchema");
  const client = createTailorKitClient({
    url: "https://host.test/api/tailorkit",
    fetch: async (input, init) => server.handler(new Request(String(input), init)),
  });
  await expect(client.actions.execute({ path: "nested.increment", input: "4" })).resolves.toBe(5);
});
