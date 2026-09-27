import { describe, expect, it } from "vite-plus/test";
import { validateLogoAsset } from "./logo-validation";

describe("logo validation", () => {
  const png = (width: number, height: number): Uint8Array => {
    const content = new Uint8Array(33);
    content.set([137, 80, 78, 71, 13, 10, 26, 10]);
    content.set([73, 72, 68, 82], 12);
    const view = new DataView(content.buffer);
    view.setUint32(8, 13);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return content;
  };

  it("accepts safe SVG logos", () => {
    const content = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M0 0h32v32H0z"/></svg>',
    );
    expect(validateLogoAsset(content, "image/svg+xml")).toEqual({});
  });

  it("rejects active SVG content", () => {
    const content = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");
    expect(() => validateLogoAsset(content, "image/svg+xml")).toThrow(
      "cannot contain scripts or external resources",
    );
  });

  it("rejects external SVG stylesheets", () => {
    const content = new TextEncoder().encode(
      '<?xml-stylesheet href="https://example.com/logo.css"?><svg></svg>',
    );
    expect(() => validateLogoAsset(content, "image/svg+xml")).toThrow(
      "cannot contain scripts or external resources",
    );
  });

  it("enforces raster dimensions", () => {
    expect(() => validateLogoAsset(png(2049, 512), "image/png")).toThrow(
      "cannot exceed 2048 by 2048",
    );
  });

  it("requires a complete PNG IHDR chunk", () => {
    const content = png(32, 32);
    content.set([73, 68, 65, 84], 12);
    expect(() => validateLogoAsset(content, "image/png")).toThrow("not a valid PNG file");
    expect(() => validateLogoAsset(content.subarray(0, 32), "image/png")).toThrow(
      "not a valid PNG file",
    );
  });

  it("enforces the 256 KiB file limit", () => {
    expect(() => validateLogoAsset(new Uint8Array(256 * 1024 + 1), "image/png")).toThrow(
      "between 1 and 262144 bytes",
    );
  });
});
