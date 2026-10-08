import { expect, it } from "vite-plus/test";
import { buildThemeCss, buildPrimitiveCss } from "./primitive-css";

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

it("builds view-scoped theme variables", () => {
  const css = buildThemeCss("screen-1", theme);
  expect(css).toContain('[data-tailorkit-view="screen-1"]');
  expect(css).toContain("--tailorkit-border-solid: solid;");
  expect(css).toContain("--tailorkit-space-md: 8px;");
  expect(css).toContain("--tailorkit-background-surface: var(--background);");
  expect(css).toContain("--tailorkit-textColor-muted: var(--muted-foreground);");
});

it("builds responsive primitive CSS without rendering a component", () => {
  const css = buildPrimitiveCss({
    viewId: "view",
    nodeId: "node",
    display: "flex",
    theme,
    props: {
      padding: "md",
      align: "start",
      justify: "between",
      width: 320,
      textColor: { base: "muted", lg: "foreground", missing: "foreground" },
    },
  });
  expect(css).toContain('[data-tailorkit-view="view"] [data-tailorkit-node="node"]');
  expect(css).toContain("padding: var(--tailorkit-space-md)");
  expect(css).toContain("width: 320px");
  expect(css).toContain("align-items: flex-start");
  expect(css).toContain("justify-content: space-between");
  expect(css).toContain("@media (min-width: 1024px)");
  expect(css.match(/@media/g)).toHaveLength(1);
});
