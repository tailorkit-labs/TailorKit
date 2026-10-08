import type { TailorKitTheme } from "@tailorkit/core/schema";
import { resolveTheme } from "@tailorkit/core/primitives/theme";

type Responsive<T> = T | Record<string, T | undefined>;
type PrimitiveValue = number | string;
export type PrimitiveProps = Record<string, unknown>;

const tokenGroups = [
  "space",
  "radius",
  "background",
  "border",
  "borderColor",
  "textColor",
] as const;

const cssEscape = (value: string): string => {
  const css = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS;
  if (typeof css?.escape === "function") {
    return css.escape(value);
  }
  return value.replaceAll(/[^A-Za-z0-9_-]/gu, "\\$&");
};

const toCssValue = (
  group: (typeof tokenGroups)[number] | "size" | "raw",
  value: PrimitiveValue,
): string => {
  if (typeof value === "number") {
    return `${value}px`;
  }
  if (group === "size" || group === "raw") {
    return value;
  }
  return `var(--tailorkit-${group}-${cssEscape(value)})`;
};

const toResponsiveEntries = <T>(value: Responsive<T> | undefined): [string, T][] => {
  if (value === undefined) {
    return [];
  }
  if (!(value && typeof value === "object") || Array.isArray(value)) {
    return [["base", value as T]];
  }
  return Object.entries(value as Record<string, T | undefined>).filter(
    (entry): entry is [string, T] => entry[1] !== undefined,
  );
};

const declarationsForProp = (prop: string, value: PrimitiveValue): string[] => {
  if (prop === "columns") {
    return [`grid-template-columns: repeat(${String(value)}, minmax(0, 1fr));`];
  }
  const tokenDeclarations: Record<string, [(typeof tokenGroups)[number], string]> = {
    background: ["background", "background"],
    border: ["border", "border"],
    borderColor: ["borderColor", "border-color"],
    textColor: ["textColor", "color"],
  };
  const tokenDeclaration = tokenDeclarations[prop];
  if (tokenDeclaration) {
    const [group, property] = tokenDeclaration;
    if (prop === "border") {
      return [`border-style: ${toCssValue(group, value)};`, "border-width: 1px;"];
    }
    return [`${property}: ${toCssValue(group, value)};`];
  }
  if (prop === "gap" || prop === "margin" || prop === "padding") {
    return [`${prop}: ${toCssValue("space", value)};`];
  }
  if (prop === "height" || prop === "width") {
    return [`${prop}: ${toCssValue("size", value)};`];
  }
  if (prop === "radius") {
    return [`border-radius: ${toCssValue("radius", value)};`];
  }
  if (prop === "align") {
    return [`align-items: ${toFlexAlignment(value)};`];
  }
  if (prop === "justify") {
    return [`justify-content: ${toFlexJustification(value)};`];
  }
  if (prop === "direction") {
    return [`flex-direction: ${toCssValue("raw", value)};`];
  }
  if (prop === "overflow") {
    return [`overflow: ${toCssValue("raw", value)};`];
  }
  if (prop === "grow") {
    return [`flex-grow: ${String(value)};`];
  }
  if (prop === "shrink") {
    return [`flex-shrink: ${String(value)};`];
  }
  if (prop === "minHeight") {
    return [`min-height: ${toCssValue("size", value)};`];
  }
  if (prop === "minWidth") {
    return [`min-width: ${toCssValue("size", value)};`];
  }
  if (prop === "basis") {
    return [`flex-basis: ${toCssValue("size", value)};`];
  }
  if (prop === "wrap") {
    return [`flex-wrap: ${toCssValue("raw", value)};`];
  }
  return [];
};

const toFlexAlignment = (value: PrimitiveValue): string => {
  if (value === "start") {
    return "flex-start";
  }
  if (value === "end") {
    return "flex-end";
  }
  return String(value);
};

const toFlexJustification = (value: PrimitiveValue): string => {
  if (value === "start") {
    return "flex-start";
  }
  if (value === "end") {
    return "flex-end";
  }
  if (value === "between") {
    return "space-between";
  }
  return String(value);
};

export const buildPrimitiveCss = ({
  display,
  nodeId,
  props,
  viewId,
  theme,
}: {
  display: "block" | "flex" | "grid" | "inline";
  nodeId: string;
  props: PrimitiveProps;
  viewId: string;
  theme: TailorKitTheme;
}): string => {
  const selector = `[data-tailorkit-view="${cssEscape(viewId)}"] [data-tailorkit-node="${cssEscape(
    nodeId,
  )}"]`;
  const base = [`display: ${display};`];
  const byBreakpoint = new Map<string, string[]>();

  for (const [prop, rawValue] of Object.entries(props)) {
    for (const [breakpoint, value] of toResponsiveEntries(rawValue as Responsive<PrimitiveValue>)) {
      const declarations = declarationsForProp(prop, value);
      if (declarations.length === 0) {
        continue;
      }
      const target = breakpoint === "base" ? base : (byBreakpoint.get(breakpoint) ?? []);
      target.push(...declarations);
      if (breakpoint !== "base") {
        byBreakpoint.set(breakpoint, target);
      }
    }
  }

  const rules = [`${selector} { ${base.join(" ")} }`];
  for (const [breakpoint, declarations] of byBreakpoint) {
    const minWidth = theme.breakpoints?.[breakpoint];
    if (!minWidth) {
      continue;
    }
    rules.push(`@media (min-width: ${minWidth}) { ${selector} { ${declarations.join(" ")} } }`);
  }

  return rules.join("\n");
};

export const buildThemeCss = (viewId: string, theme: TailorKitTheme): string => {
  const selector = `[data-tailorkit-view="${cssEscape(viewId)}"]`;
  const declarations: string[] = [];
  const resolvedTheme = resolveTheme(theme);

  for (const group of tokenGroups) {
    for (const [name, value] of Object.entries(resolvedTheme.tokens?.[group] ?? {})) {
      declarations.push(`--tailorkit-${group}-${cssEscape(name)}: ${value};`);
    }
  }

  return `${selector} { ${declarations.join(" ")} }`;
};
