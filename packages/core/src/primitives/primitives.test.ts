import { ArkErrors } from "arktype";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";
import { createTailorKitSchema } from "../schema/schema";
import { primitives as arktypePrimitives } from "./arktype";
import { primitives as valibotPrimitives } from "./valibot";
import { primitives as zodPrimitives } from "./zod";

const isValid = (schema: unknown, value: unknown): boolean => {
  if (schema && typeof schema === "object" && "safeParse" in schema) {
    return (schema as { safeParse: (input: unknown) => { success: boolean } }).safeParse(value)
      .success;
  }
  if (schema && typeof schema === "object" && "~standard" in schema) {
    return v.safeParse(schema as v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>, value)
      .success;
  }
  if (typeof schema === "function") {
    return !(schema(value) instanceof ArkErrors);
  }
  return false;
};

describe("primitive schema components", () => {
  const theme = {
    breakpoints: {
      base: null,
      sm: "640px",
      lg: "1024px",
    },
    tokens: {
      background: {
        muted: "var(--muted)",
        surface: "var(--background)",
      },
      borderColor: {
        default: "var(--border)",
      },
      textColor: {
        default: "var(--foreground)",
        muted: "var(--muted-foreground)",
      },
      radius: {
        md: "8px",
        sm: "4px",
      },
      space: {
        lg: "16px",
        md: "8px",
        sm: "4px",
      },
    },
  };

  const schema = createTailorKitSchema({
    components: {
      ...zodPrimitives(theme),
    },
  });

  it("validates primitive token props against theme token names", () => {
    const box = schema.$internal.components.Box.fields;
    expect(isValid(box, { padding: "md", radius: "sm", textColor: "muted" })).toBe(true);
    expect(isValid(box, { padding: "unknown" })).toBe(false);
    expect(isValid(box, { textColor: "unknown" })).toBe(false);
  });

  it("validates responsive primitive props against theme breakpoint names", () => {
    const flex = schema.$internal.components.Flex.fields;
    expect(isValid(flex, { direction: { base: "column", lg: "row" }, gap: { sm: "md" } })).toBe(
      true,
    );
    expect(isValid(flex, { direction: { xl: "row" } })).toBe(false);
  });

  it("serializes primitive components without schema theme metadata", () => {
    expect("theme" in schema.serialize()).toBe(false);
    expect(schema.serialize().components.Box?.children).toBe(true);
  });

  it("validates default primitive tokens", () => {
    const defaultSchema = createTailorKitSchema({
      components: {
        ...zodPrimitives(),
      },
    });
    const box = defaultSchema.$internal.components.Box.fields;

    expect(isValid(box, { border: "solid", padding: "2xs", radius: "3xl" })).toBe(true);
    expect(isValid(box, { height: "min", width: { base: "full", xl: "1/2" } })).toBe(true);
    expect(isValid(box, { overflow: { base: "hidden", lg: "auto" } })).toBe(true);
    expect(isValid(box, { overflowWrap: "breakWord", textOverflow: "ellipsis" })).toBe(true);
    expect(isValid(box, { textAlign: { base: "start", lg: "center" } })).toBe(true);
    expect(isValid(box, { textTransform: { base: "none", lg: "uppercase" } })).toBe(true);
    expect(isValid(box, { textColor: "foreground" })).toBe(false);
    expect(isValid(box, { height: "100px", width: "unknown" })).toBe(false);
    expect(isValid(box, { overflow: "overlay" })).toBe(false);
    expect(isValid(box, { overflowWrap: "break-word" })).toBe(false);
    expect(isValid(box, { textOverflow: "fade" })).toBe(false);
    expect(isValid(box, { textAlign: "middle" })).toBe(false);
    expect(isValid(box, { textTransform: "titlecase" })).toBe(false);
    expect(isValid(box, { padding: { base: "none", xl: "2xl" } })).toBe(true);
  });

  it("provides equivalent Valibot and ArkType primitive schemas", () => {
    const theme = {
      breakpoints: {
        base: null,
        lg: "1024px",
      },
      tokens: {
        background: {
          muted: "var(--muted)",
        },
        radius: {
          sm: "4px",
        },
        space: {
          md: "8px",
        },
      },
    };

    const suites = [zodPrimitives(theme), valibotPrimitives(theme), arktypePrimitives(theme)];
    for (const primitiveSuite of suites) {
      expect(isValid(primitiveSuite.Box.fields, { padding: "md", radius: "sm" })).toBe(true);
      expect(isValid(primitiveSuite.Box.fields, { padding: "unknown" })).toBe(false);
      expect(
        isValid(primitiveSuite.Flex.fields, { direction: { base: "column", lg: "row" } }),
      ).toBe(true);
      expect(isValid(primitiveSuite.Flex.fields, { direction: { xl: "row" } })).toBe(false);
      expect(isValid(primitiveSuite.Grid.fields, { columns: 3, gap: { lg: "md" } })).toBe(true);
      expect(isValid(primitiveSuite.Grid.fields, { columns: 5 })).toBe(false);
      expect(isValid(primitiveSuite.Inline.fields, { background: "muted", padding: "md" })).toBe(
        true,
      );
    }
  });
});
