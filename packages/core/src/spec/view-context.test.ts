import { expect, it } from "vite-plus/test";
import { z } from "zod";
import { createViewContextValidator } from "./view-context";

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
