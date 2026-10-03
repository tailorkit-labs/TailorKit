import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vite-plus/test";
import { buildThemeCss, PrimitiveThemeContext, primitives } from "../primitives";

const theme = {
  breakpoints: {
    base: null,
    lg: "1024px",
    sm: "640px",
  },
  tokens: {
    background: {
      surface: "var(--background)",
    },
    borderColor: {
      default: "var(--border)",
    },
    textColor: {
      foreground: "var(--foreground)",
      muted: "var(--muted-foreground)",
    },
    radius: {
      md: "8px",
    },
    space: {
      lg: "16px",
      md: "8px",
    },
  },
};

describe("react primitives", () => {
  it("builds view-scoped theme variables", () => {
    const css = buildThemeCss("screen-1", theme);
    expect(css).toContain('[data-tailorkit-view="screen-1"]');
    expect(css).toContain("--tailorkit-border-solid: solid;");
    expect(css).toContain("--tailorkit-space-md: 8px;");
    expect(css).toContain("--tailorkit-background-surface: var(--background);");
    expect(css).toContain("--tailorkit-textColor-muted: var(--muted-foreground);");
  });

  it("renders a scoped primitive style with responsive rules", () => {
    render(
      <PrimitiveThemeContext.Provider value={{ viewId: "screen-1", theme }}>
        {primitives.Flex({
          props: {
            direction: { base: "column", lg: "row" },
            border: "solid",
            gap: "md",
            padding: { base: "md", lg: "lg" },
            textColor: { base: "muted", lg: "foreground" },
          },
          children: createElement("span", null, "Content"),
        })}
      </PrimitiveThemeContext.Provider>,
    );

    const content = screen.getByText("Content");
    const node = content.parentElement;
    const style = node?.querySelector("style");
    expect(node?.tagName).toBe("DIV");
    expect(style?.textContent).toContain("display: flex;");
    expect(style?.textContent).toContain("border-style: var(--tailorkit-border-solid);");
    expect(style?.textContent).toContain("border-width: 1px;");
    expect(style?.textContent).toContain("padding: var(--tailorkit-space-md);");
    expect(style?.textContent).toContain("color: var(--tailorkit-textColor-muted);");
    expect(style?.textContent).toContain("@media (min-width: 1024px)");
    expect(style?.textContent).toContain("color: var(--tailorkit-textColor-foreground);");
    expect(style?.textContent).toContain("flex-direction: row;");
  });

  it("renders inline as a span", () => {
    render(
      <PrimitiveThemeContext.Provider value={{ viewId: "screen-2", theme }}>
        {primitives.Inline({
          props: { padding: "md" },
          children: "Label",
        })}
      </PrimitiveThemeContext.Provider>,
    );

    expect(screen.getByText("Label").tagName).toBe("SPAN");
  });
});
