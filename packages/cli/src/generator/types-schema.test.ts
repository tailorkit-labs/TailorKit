import { describe, expect, it } from "vite-plus/test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { renderGeneratedTypes } from "./types";

type JsonSchema = NonNullable<
  NonNullable<Parameters<typeof renderGeneratedTypes>[0]["views"]>[string]["context"]
>;

const cases: { name: string; schema: z.ZodType; expected: string; optional?: boolean }[] = [
  { name: "string", schema: z.string(), expected: "string" },
  { name: "number", schema: z.number(), expected: "number" },
  { name: "integer", schema: z.int(), expected: "number" },
  { name: "boolean", schema: z.boolean(), expected: "boolean" },
  { name: "null", schema: z.null(), expected: "null" },
  { name: "unknown", schema: z.unknown(), expected: "unknown" },
  { name: "any", schema: z.any(), expected: "unknown" },
  { name: "never", schema: z.never(), expected: "never" },
  { name: "string literal", schema: z.literal("hello"), expected: '"hello"' },
  { name: "escaped literal", schema: z.literal('a"b\\c'), expected: JSON.stringify('a"b\\c') },
  { name: "number literal", schema: z.literal(42), expected: "42" },
  { name: "false literal", schema: z.literal(false), expected: "false" },
  { name: "true literal", schema: z.literal(true), expected: "true" },
  { name: "zero literal", schema: z.literal(0), expected: "0" },
  { name: "empty literal", schema: z.literal(""), expected: '""' },
  { name: "enum", schema: z.enum(["new", "done"]), expected: '"new" | "done"' },
  {
    name: "mixed literals",
    schema: z.literal(["x", 1, false, null]),
    expected: '"x" | 1 | false | null',
  },
  { name: "nullable string", schema: z.string().nullable(), expected: "string | null" },
  { name: "nullable number", schema: z.number().nullable(), expected: "number | null" },
  { name: "nullable boolean", schema: z.boolean().nullable(), expected: "boolean | null" },
  { name: "nullable literal", schema: z.literal("x").nullable(), expected: '"x" | null' },
  {
    name: "nullable enum",
    schema: z.enum(["new", "done"]).nullable(),
    expected: '"new" | "done" | null',
  },
  { name: "optional string", schema: z.string().optional(), expected: "string", optional: true },
  {
    name: "nullish string",
    schema: z.string().nullish(),
    expected: "string | null",
    optional: true,
  },
  {
    name: "scalar union",
    schema: z.union([z.string(), z.number(), z.boolean()]),
    expected: "string | number | boolean",
  },
  { name: "literal union", schema: z.union([z.literal("x"), z.literal(1)]), expected: '"x" | 1' },
  { name: "union with never", schema: z.union([z.never(), z.string()]), expected: "string" },
  { name: "strings array", schema: z.array(z.string()), expected: "string[]" },
  { name: "nested array", schema: z.array(z.array(z.number())), expected: "number[][]" },
  { name: "nullable array", schema: z.array(z.string()).nullable(), expected: "string[] | null" },
  { name: "nullable items", schema: z.array(z.number().nullable()), expected: "(number | null)[]" },
  {
    name: "nullable array and items",
    schema: z.array(z.string().nullable()).nullable(),
    expected: "(string | null)[] | null",
  },
  { name: "enum array", schema: z.array(z.enum(["x", "y"])), expected: '("x" | "y")[]' },
  {
    name: "union array",
    schema: z.array(z.union([z.string(), z.number()])),
    expected: "(string | number)[]",
  },
  { name: "unknown array", schema: z.array(z.unknown()), expected: "unknown[]" },
  { name: "never array", schema: z.array(z.never()), expected: "never[]" },
  { name: "empty object", schema: z.object({}), expected: "Record<string, never>" },
  { name: "object", schema: z.object({ id: z.string() }), expected: "{ id: string; }" },
  {
    name: "optional object field",
    schema: z.object({ name: z.string().optional() }),
    expected: "{ name?: string; }",
  },
  {
    name: "nullable object",
    schema: z.object({ id: z.string() }).nullable(),
    expected: "{ id: string; } | null",
  },
  {
    name: "nested object",
    schema: z.object({ customer: z.object({ id: z.string() }).nullable() }),
    expected: "{ customer: { id: string; } | null; }",
  },
  {
    name: "quoted property",
    schema: z.object({ "display-name": z.string() }),
    expected: '{ "display-name": string; }',
  },
  {
    name: "object array",
    schema: z.array(z.object({ id: z.string() })),
    expected: "{ id: string; }[]",
  },
  {
    name: "nullable object array",
    schema: z.array(z.object({ id: z.string() }).nullable()),
    expected: "({ id: string; } | null)[]",
  },
  {
    name: "object intersection",
    schema: z.intersection(z.object({ id: z.string() }), z.object({ name: z.string() })),
    expected: "{ id: string; name: string; }",
  },
  {
    name: "discriminated union",
    schema: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("text"), text: z.string() }),
      z.object({ kind: z.literal("count"), count: z.number() }),
    ]),
    expected: '{ kind: "text"; text: string; } | { kind: "count"; count: number; }',
  },
  { name: "record", schema: z.record(z.string(), z.number()), expected: "Record<string, number>" },
  {
    name: "nullable record values",
    schema: z.record(z.string(), z.number().nullable()),
    expected: "Record<string, number | null>",
  },
  {
    name: "nullable record",
    schema: z.record(z.string(), z.boolean()).nullable(),
    expected: "Record<string, boolean> | null",
  },
  {
    name: "loose object",
    schema: z.looseObject({ id: z.string() }),
    expected: "{ id: string; } & Record<string, unknown>",
  },
  { name: "tuple", schema: z.tuple([z.string(), z.number()]), expected: "[string, number]" },
  {
    name: "nullable tuple",
    schema: z.tuple([z.string(), z.number()]).nullable(),
    expected: "[string, number] | null",
  },
  {
    name: "tuple with nullable item",
    schema: z.tuple([z.string().nullable()]),
    expected: "[string | null]",
  },
  {
    name: "tuple with rest",
    schema: z.tuple([z.string()], z.number()),
    expected: "[string, ...number[]]",
  },
  {
    name: "optional tuple item",
    schema: z.tuple([z.string(), z.number().optional()]),
    expected: "[string, (number)?]",
  },
  { name: "empty tuple", schema: z.tuple([]), expected: "[]" },
  {
    name: "tuple union rest",
    schema: z.tuple([z.string()], z.number().nullable()),
    expected: "[string, ...(number | null)[]]",
  },
  {
    name: "tuple array",
    schema: z.array(z.tuple([z.string(), z.boolean()])),
    expected: "[string, boolean][]",
  },
  {
    name: "record array",
    schema: z.array(z.record(z.string(), z.number())),
    expected: "Record<string, number>[]",
  },
  {
    name: "loose object array",
    schema: z.array(z.looseObject({ id: z.string() })),
    expected: "({ id: string; } & Record<string, unknown>)[]",
  },
  { name: "empty loose object", schema: z.looseObject({}), expected: "Record<string, unknown>" },
  {
    name: "catchall",
    schema: z.object({ id: z.number() }).catchall(z.number()),
    expected: "{ id: number; } & Record<string, number>",
  },
  {
    name: "nullable union",
    schema: z.union([z.string(), z.number()]).nullable(),
    expected: "string | number | null",
  },
  {
    name: "optional nullable object",
    schema: z.object({ id: z.string() }).nullish(),
    expected: "{ id: string; } | null",
    optional: true,
  },
  {
    name: "mixed catchall",
    schema: z.object({ id: z.string() }).catchall(z.number()),
    expected: "{ id: string; } & Record<string, number | string>",
  },
  {
    name: "optional catchall property",
    schema: z.object({ id: z.string().optional() }).catchall(z.number()),
    expected: "{ id?: string; } & Record<string, number | string | undefined>",
  },
  {
    name: "nullable catchall property",
    schema: z.object({ id: z.string().nullable() }).catchall(z.number()),
    expected: "{ id: string | null; } & Record<string, number | string | null>",
  },
];

const tupleReviewCases: { name: string; schema: JsonSchema; expected: string }[] = [
  {
    name: "required rest items",
    schema: {
      type: "array",
      prefixItems: [{ type: "string" }],
      minItems: 3,
      items: { type: "number" },
    },
    expected: "[string, number, number, ...number[]]",
  },
  {
    name: "required nullable rest items",
    schema: {
      type: "array",
      prefixItems: [{ type: "boolean" }],
      minItems: 2,
      items: { type: ["number", "null"] },
    },
    expected: "[boolean, number | null, ...(number | null)[]]",
  },
  {
    name: "required unrestricted rest items",
    schema: { type: "array", prefixItems: [{ type: "string" }], minItems: 2, items: true },
    expected: "[string, unknown, ...unknown[]]",
  },
  {
    name: "required unspecified rest items",
    schema: { type: "array", prefixItems: [], minItems: 2 },
    expected: "[unknown, unknown, ...unknown[]]",
  },
  {
    name: "impossible required rest items",
    schema: { type: "array", prefixItems: [{ type: "string" }], minItems: 2, items: false },
    expected: "never",
  },
  {
    name: "optional prefix with rest",
    schema: {
      type: "array",
      prefixItems: [{ type: "string" }, { type: "boolean" }],
      minItems: 1,
      items: { type: "number" },
    },
    expected: "[string, (boolean)?, ...number[]]",
  },
  {
    name: "closed required prefix",
    schema: { type: "array", prefixItems: [{ type: "string" }], minItems: 1, items: false },
    expected: "[string]",
  },
];

const normalize = (text: string): string => text.replaceAll(/\s+/gu, " ").trim();
const renderDeclaration = (context: JsonSchema): string => {
  const output = renderGeneratedTypes({ views: { "/": { context } } });
  return output.slice(
    output.indexOf("export interface ViewPropsByPath"),
    output.indexOf("declare module"),
  );
};

const declarations = cases.map(({ schema }) =>
  renderDeclaration(
    z
      .object({ value: schema })
      ["~standard"].jsonSchema.output({ target: "draft-2020-12" }) as JsonSchema,
  ),
);

describe("JSON Schema type generation", () => {
  it.each(cases.map((testCase, index) => ({ ...testCase, index })))(
    "generates $name",
    ({ expected, optional, index }) => {
      expect(normalize(declarations[index]!)).toBe(
        expected === "never"
          ? 'export interface ViewPropsByPath { "/": { context: never; }; }'
          : `export interface ViewPropsByPath { "/": { context: { value${optional ? "?" : ""}: ${expected}; }; }; }`,
      );
    },
  );

  it.each(cases)(
    "preserves $name in component fields, callbacks, and actions",
    ({ schema, expected }) => {
      const value = schema["~standard"].jsonSchema.output({
        target: "draft-2020-12",
      }) as JsonSchema;
      const output = normalize(
        renderGeneratedTypes({
          components: {
            Custom: {
              children: false,
              fields: { type: "object", properties: { value } },
              callbacks: { onValue: { input: value } },
            },
          },
          tools: { echo: { kind: "server", input: value, output: value } },
        }),
      );
      expect(output).toContain(`value?: ${expected};`);
      expect(output).toContain(`onValue?: (input: ${expected}) => void;`);
      expect(output).toContain(`echo: (input: ${expected}) => Promise<${expected}>;`);
    },
  );

  it.each<{ name: string; schema: JsonSchema; expected: string }>([
    { name: "null first", schema: { type: ["null", "string"] }, expected: "null | string" },
    {
      name: "duplicate types",
      schema: { type: ["number", "integer", "number"] },
      expected: "number",
    },
    { name: "empty type array", schema: { type: [] }, expected: "never" },
    { name: "never union", schema: { anyOf: [{ not: {} }, { not: {} }] }, expected: "never" },
    {
      name: "duplicate union",
      schema: { anyOf: [{ type: "string" }, { type: "string" }, { type: "null" }] },
      expected: "string | null",
    },
    { name: "unknown schema", schema: {}, expected: "unknown" },
    { name: "unknown type", schema: { type: "unsupported" }, expected: "unknown" },
    {
      name: "intersection of unions",
      schema: {
        allOf: [
          { anyOf: [{ type: "string" }, { type: "number" }] },
          { anyOf: [{ type: "string" }, { type: "boolean" }] },
        ],
      },
      expected: "(string | number) & (string | boolean)",
    },
    { name: "null const", schema: { const: null }, expected: "null" },
    {
      name: "open object",
      schema: { type: "object", additionalProperties: true },
      expected: "Record<string, unknown>",
    },
    { name: "unspecified array items", schema: { type: "array" }, expected: "unknown[]" },
    {
      name: "unrestricted array items",
      schema: { type: "array", items: true },
      expected: "unknown[]",
    },
    { name: "forbidden array items", schema: { type: "array", items: false }, expected: "never[]" },
  ])("handles raw JSON Schema: $name", ({ schema, expected }) => {
    const output = normalize(
      renderDeclaration({
        type: "object",
        properties: { value: schema, sibling: { type: "string" } },
        required: ["value", "sibling"],
      }),
    );
    expect(output).toContain(`value: ${expected};`);
  });

  it.each(tupleReviewCases)("handles reviewed tuple case: $name", ({ schema, expected }) => {
    expect(
      normalize(
        renderDeclaration({
          type: "object",
          properties: { value: schema, sibling: { type: "string" } },
          required: ["value", "sibling"],
        }),
      ),
    ).toContain(`value: ${expected};`);
  });

  it("generates TypeScript types equivalent to the expected types", async () => {
    const source = [
      "type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;",
      "type Assert<T extends true> = T;",
      ...cases.flatMap(({ expected, optional }, index) => [
        declarations[index]!.replace("ViewPropsByPath", `Case${index}`),
        `type Check${index} = Assert<Equal<Case${index}["/"]["context"]["value"], ${expected}${optional ? " | undefined" : ""}>>;`,
      ]),
      ...tupleReviewCases.flatMap(({ schema, expected }, index) => [
        renderDeclaration({
          type: "object",
          properties: { value: schema, sibling: { type: "string" } },
          required: ["value", "sibling"],
        }).replace("ViewPropsByPath", `TupleCase${index}`),
        `type TupleCheck${index} = Assert<Equal<TupleCase${index}["/"]["context"]["value"], ${expected}>>;`,
      ]),
      `const customer: Case${cases.findIndex(({ name }) => name === "mixed catchall")}["/"]["context"]["value"] = { id: "customer-1", extra: 42 };`,
      'const tuple: TupleCase0["/"]["context"]["value"] = ["first", 1, 2];',
      "// @ts-expect-error Required rest items must not be omitted.",
      'const shortTuple: TupleCase0["/"]["context"]["value"] = ["first"];',
      "// @ts-expect-error Required rest items must use the items schema type.",
      'const invalidTuple: TupleCase0["/"]["context"]["value"] = ["first", false, 2];',
    ].join("\n");
    const root = await mkdtemp(path.join(tmpdir(), "tailorkit-generated-type-check-"));
    try {
      await writeFile(path.join(root, "generated.ts"), source);
      await writeFile(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            noEmit: true,
            strict: true,
            skipLibCheck: true,
            types: [],
            target: "ESNext",
          },
          files: ["generated.ts"],
        }),
      );
      const require = createRequire(import.meta.url);
      const compiler = path.join(
        path.dirname(require.resolve("typescript/package.json")),
        "bin/tsc",
      );
      const result = await promisify(execFile)(process.execPath, [
        compiler,
        "-p",
        path.join(root, "tsconfig.json"),
      ]);
      expect(result.stdout).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
