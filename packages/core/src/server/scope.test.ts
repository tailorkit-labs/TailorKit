import { describe, expect, it } from "vite-plus/test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";
import { normalizeTailorKitScope, validateTailorKitScope } from "./scope";

describe("TailorKit scope validation", () => {
  it("returns a frozen copy with keys in stable lexical order", () => {
    const input = { userId: "user_1", orgId: "org_1" };
    const scope = normalizeTailorKitScope(input);

    expect(Object.keys(scope)).toEqual(["orgId", "userId"]);
    expect(scope).not.toBe(input);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(input).toEqual({ userId: "user_1", orgId: "org_1" });
  });

  it("uses the Standard Schema normalized output", async () => {
    const schema = z
      .object({ tenant: z.string() })
      .transform(({ tenant }) => ({ tenant: tenant.trim() }));

    await expect(validateTailorKitScope(schema, { tenant: "  org_1  " })).resolves.toEqual({
      tenant: "org_1",
    });
  });

  it("accepts Standard Schema validators without a JSON Schema converter", async () => {
    const schema: StandardSchemaV1<{ workspaceId: string }, { workspaceId: string }> = {
      "~standard": {
        version: 1,
        vendor: "scope-test",
        types: {} as StandardSchemaV1.Types<{ workspaceId: string }, { workspaceId: string }>,
        validate: (value) =>
          typeof value === "object" && value !== null && "workspaceId" in value
            ? { value: value as { workspaceId: string } }
            : { issues: [{ message: "workspaceId is required" }] },
      },
    };

    await expect(validateTailorKitScope(schema, { workspaceId: "workspace_1" })).resolves.toEqual({
      workspaceId: "workspace_1",
    });
  });

  it("rejects values that do not normalize to a flat nonempty string record", () => {
    expect(() => normalizeTailorKitScope({})).toThrow(/between 1 and 32/u);
    expect(() => normalizeTailorKitScope({ org: "" })).toThrow(/nonempty strings/u);
    expect(() => normalizeTailorKitScope({ org: { id: "org_1" } })).toThrow(/nonempty strings/u);
    expect(() => normalizeTailorKitScope(new Date())).toThrow(/flat record/u);
  });

  it("rejects outputs with too many or oversized fields", () => {
    const tooManyFields = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`field${index}`, "value"]),
    );

    expect(() => normalizeTailorKitScope(tooManyFields)).toThrow(/between 1 and 32/u);
    expect(() => normalizeTailorKitScope({ ["k".repeat(65)]: "value" })).toThrow(/field names/u);
    expect(() => normalizeTailorKitScope({ value: "x".repeat(256) })).toThrow(/at most 255/u);
  });
});
