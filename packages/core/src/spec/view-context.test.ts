import { expect, it } from "vite-plus/test";
import { z } from "zod";
import { createViewContextParser, createViewContextValidator } from "./view-context";

const schema = z.object({
  customer: z.object({ id: z.string(), email: z.email() }),
  roles: z.array(z.enum(["admin", "viewer"])).min(1),
});

it("validates serialized context including nested fields, formats, and arrays", () => {
  const validate = createViewContextValidator(z.toJSONSchema(schema));
  expect(validate({ customer: { id: "c1", email: "a@example.com" }, roles: ["admin"] })).toBeNull();
  expect(validate({ customer: { id: 123, email: "invalid" }, roles: [] })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: ["customer", "id"] }),
      expect.objectContaining({ path: ["customer", "email"] }),
      expect.objectContaining({ path: ["roles"] }),
    ]),
  );
  expect(validate({})).not.toBeNull();
  expect(validate(null)).not.toBeNull();
});

it("keeps supplied context intact even when parsing would apply defaults", () => {
  const validate = createViewContextValidator(
    z.toJSONSchema(z.object({ label: z.string().default("Default") }), { io: "input" }),
  );
  const context = {};
  expect(validate(context)).toBeNull();
  expect(context).toEqual({});
});

it("strips extra root and nested fields without mutating supplied context", () => {
  const parse = createViewContextParser(z.toJSONSchema(schema));
  const context = {
    customer: { id: "c1", email: "a@example.com", emailVerified: true },
    roles: ["admin"],
    extra: true,
  };
  expect(parse(context)).toEqual({
    success: true,
    data: { customer: { id: "c1", email: "a@example.com" }, roles: ["admin"] },
  });
  expect(context.customer.emailVerified).toBe(true);
  expect(context.extra).toBe(true);
  expect(createViewContextValidator(z.toJSONSchema(schema))(context)).toBeNull();
});

it("strips objects inside optional fields, arrays, and unions while validating declared fields", () => {
  const parse = createViewContextParser(
    z.toJSONSchema(
      z.object({
        users: z.array(
          z.union([
            z.object({ kind: z.literal("member"), id: z.string() }),
            z.object({ kind: z.literal("guest"), name: z.string() }),
          ]),
        ),
        settings: z.object({ enabled: z.boolean() }).optional(),
      }),
    ),
  );
  expect(
    parse({
      users: [
        { kind: "member", id: "u1", email: "a@example.com" },
        { kind: "guest", name: "Guest", isAnonymous: true },
      ],
      settings: { enabled: true, extra: true },
    }),
  ).toEqual({
    success: true,
    data: {
      users: [
        { kind: "member", id: "u1" },
        { kind: "guest", name: "Guest" },
      ],
      settings: { enabled: true },
    },
  });
  expect(parse({ users: [{ kind: "member", id: 123, extra: true }] }).success).toBe(false);
});

it("retains explicitly allowed keys and validates catchall and record values", () => {
  const parse = createViewContextParser(
    z.toJSONSchema(
      z.object({
        open: z.looseObject({ id: z.string() }),
        catchall: z.object({ id: z.string() }).catchall(z.number()),
        records: z.record(z.string(), z.object({ id: z.string() })),
      }),
    ),
  );
  expect(
    parse({
      open: { id: "u1", extra: true },
      catchall: { id: "u1", count: 2 },
      records: { first: { id: "u1", extra: true } },
    }),
  ).toEqual({
    success: true,
    data: {
      open: { id: "u1", extra: true },
      catchall: { id: "u1", count: 2 },
      records: { first: { id: "u1" } },
    },
  });
  expect(
    parse({ open: { id: "u1" }, catchall: { id: "u1", count: "bad" }, records: {} }).success,
  ).toBe(false);
});

it("strips fields in recursive schema references", () => {
  const parse = createViewContextParser({
    type: "object",
    properties: { node: { $ref: "#/$defs/node" } },
    required: ["node"],
    additionalProperties: false,
    $defs: {
      node: {
        type: "object",
        properties: { id: { type: "string" }, child: { $ref: "#/$defs/node" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  });
  expect(parse({ node: { id: "n1", extra: true, child: { id: "n2", extra: true } } })).toEqual({
    success: true,
    data: { node: { id: "n1", child: { id: "n2" } } },
  });
});
