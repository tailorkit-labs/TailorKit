// @vitest-environment happy-dom

import { describe, expect, it } from "vite-plus/test";
import { readElementProps } from "./serialize.js";

describe("readElementProps", () => {
  it.each(["textColor", "textcolor"])("canonicalizes the %s DOM attribute to textColor", (name) => {
    const element = document.createElement("tailorkit-box");
    element.setAttribute(name, "muted");

    expect(readElementProps(element)).toEqual({ textColor: "muted" });
  });

  it("preserves typed props and their declared names", () => {
    const element = document.createElement("tailorkit-card");
    element.setAttribute(
      "data-tailorkit-props",
      JSON.stringify({
        count: 3,
        enabled: false,
        metadata: { owner: "TailorKit" },
        textColor: "default",
      }),
    );
    element.setAttribute("data-tailorkit-callbacks", "{}");

    expect(readElementProps(element)).toEqual({
      count: 3,
      enabled: false,
      metadata: { owner: "TailorKit" },
      textColor: "default",
    });
  });

  it("excludes internal protocol attributes from the fallback props", () => {
    const element = document.createElement("tailorkit-button");
    element.setAttribute("data-tailorkit-callbacks", "{}");
    element.setAttribute("data-tailorkit-props", "invalid JSON");
    element.setAttribute("disabled", "false");

    expect(readElementProps(element)).toEqual({ disabled: "false" });
  });
});
