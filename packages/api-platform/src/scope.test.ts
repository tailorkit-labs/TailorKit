import { describe, expect, it } from "vite-plus/test";
import { canonicalizeScope, scopeMatches, scopeSchema } from "./scope";

describe("scope canonicalization", () => {
  it("sorts object properties recursively and preserves array order", () => {
    const first = canonicalizeScope({
      name: "organization",
      value: {
        orgId: "org_123",
        settings: { enabled: true, mode: "compact" },
        members: ["user_1", { last: "Lovelace", first: "Ada" }],
      },
    });
    const reordered = canonicalizeScope({
      name: "organization",
      value: {
        members: ["user_1", { first: "Ada", last: "Lovelace" }],
        settings: { mode: "compact", enabled: true },
        orgId: "org_123",
      },
    });

    expect(first.scopeKey).toMatch(/^[a-f0-9]{32}$/u);
    expect(reordered).toEqual(first);
    expect(
      canonicalizeScope({
        name: "organization",
        value: {
          orgId: "org_123",
          settings: { enabled: true, mode: "compact" },
          members: [{ first: "Ada", last: "Lovelace" }, "user_1"],
        },
      }).scopeKey,
    ).not.toBe(first.scopeKey);
  });

  it("includes the scope name in the identity", () => {
    const sameValue = { organizationId: "org_123" };
    expect(canonicalizeScope({ name: "organization", value: sameValue }).scopeKey).not.toBe(
      canonicalizeScope({ name: "user", value: sameValue }).scopeKey,
    );
  });

  it("supports nested JSON values but rejects values that are not safe JSON", () => {
    expect(
      canonicalizeScope({ name: "organization", value: { metadata: { labels: [], data: {} } } })
        .scope.value,
    ).toEqual({ metadata: { labels: [], data: {} } });
    expect(() => canonicalizeScope({ name: "organization", value: {} })).toThrow();
    expect(() => canonicalizeScope({ name: "organization", value: { id: undefined } })).toThrow();
    expect(() => canonicalizeScope({ name: "organization", value: { id: -0 } })).toThrow();
    expect(() => canonicalizeScope({ name: "organization", value: { id: Number.NaN } })).toThrow();
    expect(() => canonicalizeScope({ name: "organization", value: { id: 2 ** 53 } })).toThrow();
    expect(() => canonicalizeScope([])).toThrow();
  });

  it("rejects __proto__ keys instead of silently losing them during schema parsing", () => {
    const rootValue = JSON.parse('{"__proto__":"unexpected","orgId":"org_123"}') as unknown;
    const nestedValue = JSON.parse(
      '{"orgId":"org_123","labels":[{"__proto__":"unexpected"}]}',
    ) as unknown;
    expect(scopeSchema.safeParse({ name: "organization", value: rootValue }).success).toBe(false);
    expect(scopeSchema.safeParse({ name: "organization", value: nestedValue }).success).toBe(false);
    expect(() => canonicalizeScope({ name: "organization", value: rootValue })).toThrow();
    expect(() => canonicalizeScope({ name: "organization", value: nestedValue })).toThrow();
  });

  it("uses the same root-inclusive 512-value boundary in schema and canonicalization", () => {
    const value = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [
        `key${index}`,
        Array.from({ length: index === 31 ? 14 : 15 }, () => null),
      ]),
    );
    const scope = { name: "organization", value };
    expect(scopeSchema.safeParse(scope).success).toBe(true);
    expect(() => canonicalizeScope(scope)).not.toThrow();

    value.key31?.push(null);
    const result = scopeSchema.safeParse(scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("512 JSON values");
    expect(() => canonicalizeScope(scope)).toThrow(/512 values/u);
  });

  it("reports the violated schema bound", () => {
    const parse = (value: unknown) => scopeSchema.safeParse({ name: "organization", value });
    const tooManyKeys = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`key${index}`, index]),
    );
    const tooManyBytes = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [
        `key${index}`,
        Array.from({ length: 10 }, () => "x".repeat(255)),
      ]),
    );
    for (const [value, message] of [
      [tooManyKeys, "1–32 entries"],
      [{ id: -0 }, "cannot be -0"],
      [tooManyBytes, "16 KiB"],
    ] as const) {
      const result = parse(value);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.message).toContain(message);
    }
  });

  it("compares the canonical named scope identity", () => {
    expect(
      scopeMatches(
        { name: "organization", value: { teamId: "team_123", labels: [{ b: 2, a: 1 }] } },
        { name: "organization", value: { labels: [{ a: 1, b: 2 }], teamId: "team_123" } },
      ),
    ).toBe(true);
    expect(
      scopeMatches(
        { name: "organization", value: { teamId: "team_123" } },
        { name: "user", value: { teamId: "team_123" } },
      ),
    ).toBe(false);
  });
});
