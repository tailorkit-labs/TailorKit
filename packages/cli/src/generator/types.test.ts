import { describe, expect, it } from "vite-plus/test";

import { z } from "zod";
import { createTailorKitSchema } from "@tailorkit/core/schema";
import { TailorKitSchemaSpec } from "@tailorkit/core/spec";

import { renderGeneratedTypes } from "./types";

describe("renderGeneratedTypes", () => {
  it("generates view props from schema views", () => {
    const output = renderGeneratedTypes({
      components: {},
      views: {
        "/test": {
          context: {
            additionalProperties: false,
            properties: {},
            type: "object",
          },
        },
      },
    });

    expect(output).toContain('"/test": {');
    expect(output).toContain("context: Record<string, never>;");
  });

  it("generates component props from fields and callbacks", () => {
    const output = renderGeneratedTypes({
      components: {
        Button: {
          callbacks: {
            onClick: {},
            onValueChange: {
              input: {
                additionalProperties: false,
                properties: {
                  value: {
                    type: "string",
                  },
                },
                required: ["value"],
                type: "object",
              },
            },
          },
          fields: {
            additionalProperties: false,
            properties: {
              disabled: {
                type: "boolean",
              },
              label: {
                type: "string",
              },
            },
            required: ["label"],
            type: "object",
          },
          children: true,
        },
      },
      views: {},
    });

    expect(output).not.toContain("export type Disabled = boolean;");
    expect(output).not.toContain("export type Label = string;");
    expect(output).toContain("disabled?: boolean;");
    expect(output).toContain("label?: string;");
    expect(output).toContain("onClick?: () => void;");
    expect(output).toContain("onValueChange?: (input: {");
    expect(output).toContain("value: string;");
    expect(output).toContain("createRemoteComponent<ButtonProps, true>");
    expect(output).toContain('callbacks: { "onClick": 0, "onValueChange": 1 }');
  });

  it("supports fieldKeys from older schema files", () => {
    const output = renderGeneratedTypes({
      components: {
        Button: {
          callbacks: {},
          fieldKeys: ["variant"],
          children: true,
        },
      },
      views: {},
    });

    expect(output).not.toContain("export type Variant = unknown;");
    expect(output).toContain("variant?: unknown;");
  });

  it("generates primitive component props from serialized fields", () => {
    const output = renderGeneratedTypes({
      components: {
        Box: {
          callbacks: {},
          fields: {
            properties: {
              padding: {
                enum: ["sm", "md", "lg"],
                type: "string",
              },
            },
            type: "object",
          },
          children: true,
        },
      },
      views: {},
    });

    expect(output).toContain("export interface BoxProps");
    expect(output).toContain('export type Padding = "sm" | "md" | "lg";');
    expect(output).toContain("padding?: Padding;");
    expect(output).toContain("createRemoteComponent<BoxProps, true>");
  });

  it("generates literal responsive primitive token props", () => {
    const output = renderGeneratedTypes({
      components: {
        Box: {
          callbacks: {},
          fields: {
            properties: {
              margin: {
                anyOf: [
                  {
                    enum: ["lg", "xl"],
                    type: "string",
                  },
                  {
                    additionalProperties: false,
                    properties: {
                      base: {
                        enum: ["lg", "xl"],
                        type: "string",
                      },
                      md: {
                        enum: ["lg", "xl"],
                        type: "string",
                      },
                    },
                    type: "object",
                  },
                ],
              },
            },
            type: "object",
          },
          children: true,
        },
      },
      views: {},
    });

    expect(output).toContain(
      'export type Breakpoint = "base" | "sm" | "md" | "lg" | "xl" | "2xl";',
    );
    expect(output).toContain(
      "export type Responsive<TValue> = TValue | Partial<Record<Breakpoint, TValue>>;",
    );
    expect(output).toContain('export type Margin = Responsive<"lg" | "xl">;');
    expect(output).toContain("margin?: Margin;");
  });

  it("generates literal responsive primitive props from const unions", () => {
    const responsiveConstUnion = (...values: string[]) => ({
      anyOf: [
        {
          anyOf: values.map((value) => ({ const: value, type: "string" })),
        },
        {
          additionalProperties: false,
          properties: {
            base: {
              anyOf: values.map((value) => ({ const: value, type: "string" })),
            },
            md: {
              anyOf: values.map((value) => ({ const: value, type: "string" })),
            },
          },
          type: "object",
        },
      ],
    });

    const output = renderGeneratedTypes({
      components: {
        Flex: {
          callbacks: {},
          fields: {
            properties: {
              align: responsiveConstUnion("start", "center", "end", "stretch"),
              direction: responsiveConstUnion("row", "column"),
              grow: responsiveConstUnion("0", "1"),
              justify: responsiveConstUnion("start", "center", "end", "between"),
              shrink: responsiveConstUnion("0", "1"),
              wrap: responsiveConstUnion("wrap", "nowrap", "wrap-reverse"),
            },
            type: "object",
          },
          children: true,
        },
      },
      views: {},
    });

    expect(output).toContain('export type Grow = Responsive<"0" | "1">;');
    expect(output).toContain('export type Shrink = Responsive<"0" | "1">;');
    expect(output).toContain(
      'export type Align = Responsive<"start" | "center" | "end" | "stretch">;',
    );
    expect(output).toContain('export type Direction = Responsive<"row" | "column">;');
    expect(output).toContain(
      'export type Justify = Responsive<"start" | "center" | "end" | "between">;',
    );
    expect(output).toContain('export type Wrap = Responsive<"wrap" | "nowrap" | "wrap-reverse">;');
    expect(output).toContain("direction?: Direction;");
  });

  it("generates never for primitive props with no configured tokens", () => {
    const output = renderGeneratedTypes({
      components: {
        Box: {
          callbacks: {},
          fields: {
            properties: {
              background: {
                anyOf: [
                  {
                    not: {},
                  },
                  {
                    additionalProperties: false,
                    properties: {
                      base: {
                        not: {},
                      },
                      md: {
                        not: {},
                      },
                    },
                    type: "object",
                  },
                ],
              },
            },
            type: "object",
          },
          children: true,
        },
      },
      views: {},
    });

    expect(output).toContain("export type Background = never;");
    expect(output).toContain("background?: Background;");
  });

  it("generates typed action callers without request context", () => {
    const output = renderGeneratedTypes({
      actions: {
        todo: {
          create: {
            input: {
              properties: {
                title: { type: "string" },
              },
              required: ["title"],
              type: "object",
            },
            output: {
              properties: {
                id: { type: "string" },
                title: { type: "string" },
              },
              required: ["id", "title"],
              type: "object",
            },
          },
        },
      },
      components: {},
      views: {},
    });

    expect(output).toContain("export type TailorKitActions = {");
    expect(output).toContain("todo: {");
    expect(output).toContain("create: (input: {");
    expect(output).toContain("title: string;");
    expect(output).toContain("}) => Promise<{");
    expect(output).toContain("id: string;");
    expect(output).not.toContain("requestContext");
  });
});

it("composes independent ancestor contexts and generates slot names", () => {
  const generated = renderGeneratedTypes({
    components: {},
    slots: { panel: { views: ["/", "/users", "/users/detail"] }, navbar: { views: ["/"] } },
    views: {
      "/": {
        context: {
          type: "object",
          properties: { workspaceId: { type: "string" } },
          required: ["workspaceId"],
        },
      },
      "/users": {
        context: {
          type: "object",
          properties: { canManage: { type: "boolean" } },
          required: ["canManage"],
        },
      },
      "/users/detail": {
        context: {
          type: "object",
          properties: { userId: { type: "string" } },
          required: ["userId"],
        },
      },
    },
  });
  expect(generated).toContain(
    'interface TailorKitSlots { "panel": "/" | "/users" | "/users/detail"; "navbar": "/"; }',
  );
  const detail = generated.slice(
    generated.indexOf('"/users/detail":'),
    generated.indexOf("declare module"),
  );
  expect(detail).toContain("workspaceId");
  expect(detail).toContain("canManage");
  expect(detail).toContain("userId");
  expect(detail).toContain(" & ");
});

it("preserves optional ancestor fields through schema serialization and generation", () => {
  const schema = createTailorKitSchema({
    components: {},
    contexts: {
      "/": z.object({ workspaceId: z.string() }).optional(),
      "/detail": z.object({ id: z.string() }),
    },
    slots: { panel: { views: ["/detail"] } },
  }).serialize();
  const parsed = TailorKitSchemaSpec.parse(schema);
  expect(parsed.views["/"]?.contextOptional).toBe(true);
  expect(parsed.views["/detail"]?.contextOptional).toBeUndefined();
  const output = renderGeneratedTypes(parsed);
  expect(output).toContain(
    "context: (Partial<{\n      workspaceId: string;\n    }>) & ({\n      id: string;\n    });",
  );
});
