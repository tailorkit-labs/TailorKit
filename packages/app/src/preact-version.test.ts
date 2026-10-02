import { describe, expect, it } from "vite-plus/test";
import { assertSupportedPreactVersion } from "./preact-version";

describe("supported Preact versions", () => {
  it.each(["10.0.0", "10.29.8", "9.5.0"])("rejects Preact %s", (version) => {
    expect(() => assertSupportedPreactVersion(version)).toThrow(
      `TailorKit requires Preact 11.0.0 or newer, but found ${version}.`,
    );
  });

  it.each(["11.0.0", "11.1.0"])("accepts Preact %s", (version) => {
    expect(assertSupportedPreactVersion(version)).toEqual({ major: 11, version });
  });

  it("reports an unreadable version", () => {
    expect(() => assertSupportedPreactVersion("unknown")).toThrow(
      'Unable to parse Preact version "unknown".',
    );
  });
});
