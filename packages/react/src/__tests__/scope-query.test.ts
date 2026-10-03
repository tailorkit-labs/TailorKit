import { describe, expect, it } from "vite-plus/test";
import { appendScopeSelection } from "../scope-query";

describe("appendScopeSelection", () => {
  it("encodes an explicit empty scope selection for the host", () => {
    const url = new URL("apps", "https://host.test/api/tailorkit/");

    appendScopeSelection(url, []);

    expect(url.toString()).toBe("https://host.test/api/tailorkit/apps?scopes=");
  });
});
