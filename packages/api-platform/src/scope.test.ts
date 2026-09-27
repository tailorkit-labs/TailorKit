import { describe, expect, it } from "vite-plus/test";
import { canonicalizeScope, scopeMatches } from "./scope";

describe("scope canonicalization", () => {
  it("derives the same versioned key independent of property insertion order", () => {
    const first = canonicalizeScope({ organizationId: "org_123", userId: "user_456" });
    const reordered = canonicalizeScope({ userId: "user_456", organizationId: "org_123" });

    expect(first.scope).toEqual({ organizationId: "org_123", userId: "user_456" });
    expect(first.scopeKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(reordered).toEqual(first);
  });

  it("rejects non-flat or empty scope records", () => {
    expect(() => canonicalizeScope({})).toThrow();
    expect(() => canonicalizeScope({ userId: "" })).toThrow();
    expect(() => canonicalizeScope({ identity: { userId: "user_456" } })).toThrow();
    expect(() => canonicalizeScope([])).toThrow();
  });

  it("compares the full normalized scope as well as its key", () => {
    expect(scopeMatches({ teamId: "team_123" }, { teamId: "team_123" })).toBe(true);
    expect(scopeMatches({ teamId: "team_123" }, { teamId: "team_456" })).toBe(false);
    expect(scopeMatches({ teamId: "team_123" }, { teamId: "team_123", userId: "user_456" })).toBe(
      false,
    );
  });
});
