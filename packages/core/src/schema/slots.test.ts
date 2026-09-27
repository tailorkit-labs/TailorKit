import { describe, expect, it } from "vite-plus/test";
import { createTailorKitSchema } from "./schema";
import { TailorKitSchemaSpec } from "../spec/spec";
import { z } from "zod";

describe("slot view contracts", () => {
  it("serializes supported view lists", () => {
    const schema = createTailorKitSchema({
      components: {},
      contexts: { "/": z.object({}), "/users": z.object({}) },
      slots: { navbar: { views: ["/"] }, panel: { views: ["/users"] } },
    }).serialize();
    expect(TailorKitSchemaSpec.parse(schema).slots).toEqual({
      navbar: { views: ["/"] },
      panel: { views: ["/users"] },
    });
  });

  it("rejects unknown view references in serialized schemas", () => {
    expect(
      TailorKitSchemaSpec.safeParse({
        version: 1,
        components: {},
        views: { "/": {} },
        slots: { panel: { views: ["/missing"] } },
      }).success,
    ).toBe(false);
  });

  it("rejects untyped host configurations with undeclared views", () => {
    expect(() =>
      createTailorKitSchema({
        components: {},
        contexts: { "/": z.object({}) },
        // @ts-expect-error Exercise runtime validation for JavaScript hosts.
        slots: { panel: { views: ["/missing"] } },
      }),
    ).toThrow('references undeclared view "/missing"');
  });
});
