import { describe, expect, it } from "vite-plus/test";

import { getSameOriginPath, getSameOriginUrl } from "./safe-return-url";

const ORIGIN = "https://tailorkit.dev";

describe("getSameOriginPath", () => {
  it("returns only the path, search, and hash for same-origin URLs", () => {
    expect(getSameOriginPath("https://tailorkit.dev/apps?tab=usage#details", ORIGIN)).toBe(
      "/apps?tab=usage#details",
    );
    expect(getSameOriginPath("/apps?tab=usage#details", ORIGIN)).toBe("/apps?tab=usage#details");
  });

  it("rejects cross-origin and malformed URLs", () => {
    expect(getSameOriginPath("https://attacker.example/apps", ORIGIN)).toBeUndefined();
    expect(getSameOriginPath("//attacker.example/apps", ORIGIN)).toBeUndefined();
    expect(getSameOriginPath("https://%", ORIGIN)).toBeUndefined();
  });

  it("returns an absolute same-origin URL for auth callbacks", () => {
    expect(getSameOriginUrl("/tailorkit/~/projects", ORIGIN)).toBe(
      "https://tailorkit.dev/tailorkit/~/projects",
    );
    expect(getSameOriginUrl("https://attacker.example/apps", ORIGIN)).toBeUndefined();
  });
});
