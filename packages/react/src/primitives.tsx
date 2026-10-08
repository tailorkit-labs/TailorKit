import { createContext, useContext, useId, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { TailorKitTheme } from "@tailorkit/core/schema";
import { buildPrimitiveCss } from "@tailorkit/client-core";
import type { PrimitiveProps } from "@tailorkit/client-core";

interface PrimitiveThemeContextValue {
  viewId: string;
  theme: TailorKitTheme;
}

export const PrimitiveThemeContext = createContext<PrimitiveThemeContextValue | null>(null);

const usePrimitiveNodeId = (): string => {
  const id = useId();
  return useMemo(() => `tailorkit-${id.replaceAll(":", "")}`, [id]);
};

const Primitive = ({
  children,
  display,
  element,
  props,
}: {
  children?: ReactNode;
  display: "block" | "flex" | "grid" | "inline";
  element: "div" | "span";
  props: PrimitiveProps;
}): ReactNode => {
  const context = useContext(PrimitiveThemeContext);
  const nodeId = usePrimitiveNodeId();
  const Element = element;
  const css = context
    ? buildPrimitiveCss({
        display,
        nodeId,
        props,
        viewId: context.viewId,
        theme: context.theme,
      })
    : "";

  return (
    <Element data-tailorkit-node={nodeId}>
      {css === "" ? null : <style data-tailorkit-node-style={nodeId}>{css}</style>}
      {children}
    </Element>
  );
};

export const primitives = {
  Box: ({ props, children }: { props: PrimitiveProps; children?: ReactNode }) => (
    <Primitive display="block" element="div" props={props}>
      {children}
    </Primitive>
  ),
  Flex: ({ props, children }: { props: PrimitiveProps; children?: ReactNode }) => (
    <Primitive display="flex" element="div" props={props}>
      {children}
    </Primitive>
  ),
  Grid: ({ props, children }: { props: PrimitiveProps; children?: ReactNode }) => (
    <Primitive display="grid" element="div" props={props}>
      {children}
    </Primitive>
  ),
  Inline: ({ props, children }: { props: PrimitiveProps; children?: ReactNode }) => (
    <Primitive display="inline" element="span" props={props}>
      {children}
    </Primitive>
  ),
} as const;

export type PrimitiveStyle = CSSProperties;
