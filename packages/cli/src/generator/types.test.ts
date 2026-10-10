import { describe, expect, it, vi } from "vite-plus/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";
import { tool, defineContract, createTailorKitSchema } from "@tailorkit/core/schema";
import { createServer } from "@tailorkit/core/server";
import { TailorKitSchemaSpec } from "@tailorkit/core/spec";

import { generateTypes, readSchemaFile, renderGeneratedTypes } from "./types";

it.each([undefined, "{", '{"version":2,"components":{}}'])(
  "includes the original schema loading error and preserves its cause for %s",
  async (content) => {
    const root = await mkdtemp(path.join(tmpdir(), "tailorkit-schema-error-"));
    const schemaPath = path.join(root, "schema.json");
    try {
      if (content !== undefined) await writeFile(schemaPath, content);
      let failure: unknown;
      try {
        await readSchemaFile(schemaPath);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      const error = failure as Error;
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.message).toBe(
        `Unable to read TailorKit schema from ${schemaPath}: ${(error.cause as Error).message}`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("links the app to the configured server entry and never falls back to an unrelated default file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-configured-server-types-"));
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(Response.json({ components: {}, views: {} })));
  try {
    await mkdir(path.join(root, "backend"));
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.test", server: { entry: "./backend/api.ts" } };',
    );
    await writeFile(
      path.join(root, "backend/api.ts"),
      'throw new Error("Never evaluate server code");',
    );
    await writeFile(path.join(root, "src/server.ts"), 'throw new Error("Unused default server");');
    const generated = await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf8")).toContain('import type app from "../backend/api"');
    const custom = await generateTypes({ cwd: root, outFile: "src/generated/host.ts" });
    expect(await readFile(custom, "utf8")).toContain('import type app from "../../backend/api"');
    await rm(path.join(root, "backend/api.ts"));
    await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf8")).not.toContain("createApi");
  } finally {
    fetch.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves the type-only API link when regenerating host types, including custom paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-host-types-"));
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(Response.json({ components: {}, views: {} })));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src/server.ts"),
      'throw new Error("Never evaluate server code");',
    );
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.test", server: {} };',
    );
    const generated = await generateTypes({ cwd: root });
    const output = await readFile(generated, "utf-8");
    expect(output).toContain('import type app from "./server"');
    expect(output).toContain("export const api = createApi<typeof app.functions>();");
    const custom = await generateTypes({ cwd: root, outFile: "src/generated/host.ts" });
    expect(await readFile(custom, "utf-8")).toContain('import type app from "../server"');
    await rm(path.join(root, "src/server.ts"));
    const missing = await generateTypes({ cwd: root });
    expect(await readFile(missing, "utf-8")).not.toContain("createApi");
  } finally {
    fetch.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it("detects the default server file without server configuration and removes stale API imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-detect-server-"));
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(Response.json({ components: {}, views: {} })));
  try {
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.test" };',
    );
    const generated = await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf-8")).not.toContain("createApi");
    const server = path.join(root, "src/server.ts");
    await writeFile(server, 'throw new Error("Never evaluate server code");');
    await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf-8")).toContain('import type app from "./server"');
    expect(await readFile(generated, "utf-8")).toContain(
      "export const api = createApi<typeof app.functions>();",
    );
    const custom = await generateTypes({ cwd: root, outFile: "src/generated/host.ts" });
    expect(await readFile(custom, "utf-8")).toContain('import type app from "../server"');
    await rm(server);
    await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf-8")).not.toContain("createApi");
    await mkdir(server);
    await generateTypes({ cwd: root });
    expect(await readFile(generated, "utf-8")).not.toContain("createApi");
  } finally {
    fetch.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

describe("renderGeneratedTypes", () => {
  it("preserves nullable view context fields through schema serialization and generation", () => {
    const schema = createTailorKitSchema({
      components: {},
      views: {
        "/": z.object({
          customer: z.object({ id: z.string(), name: z.string() }).nullable(),
          label: z.string().nullable(),
          count: z.number().nullable(),
          enabled: z.boolean().nullable(),
          empty: z.null(),
          labels: z.array(z.string().nullable()),
          customers: z.array(z.object({ id: z.string() }).nullable()),
          tags: z.array(z.string()).nullable(),
        }),
      },
      slots: { sidebar: { views: ["/"] } },
    }).serialize();

    const output = renderGeneratedTypes(TailorKitSchemaSpec.parse(schema));

    expect(output).toContain(
      "customer: {\n        id: string;\n        name: string;\n      } | null;",
    );
    expect(output).toContain("label: string | null;");
    expect(output).toContain("count: number | null;");
    expect(output).toContain("enabled: boolean | null;");
    expect(output).toContain("empty: null;");
    expect(output).toContain("labels: (string | null)[];");
    expect(output).toContain("customers: ({\n        id: string;\n      } | null)[];");
    expect(output).toContain("tags: string[] | null;");
    expect(output).not.toContain("unknown");
  });

  it("preserves and deduplicates every type in a JSON Schema type array", () => {
    const output = renderGeneratedTypes({
      views: {
        "/": {
          context: {
            type: "object",
            properties: {
              value: { type: ["null", "string", "integer", "number", "boolean"] },
            },
            required: ["value"],
          },
        },
      },
    });

    expect(output).toContain("value: null | string | number | boolean;");
  });

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

  it("generates caller input types before transforms and return types after transforms", async () => {
    const server = createServer({
      baseUrl: "https://example.com/api/tailorkit",
      contract: defineContract({
        scopes: { user: z.object({ userId: z.string() }) },
        tools: {
          nested: {
            increment: tool
              .server()
              .input(z.string().transform(Number).pipe(z.number()))
              .output(z.union([z.string(), z.number()]).transform(Number).pipe(z.number())),
          },
        },
      }),
      tools: { nested: { increment: ({ input }) => input + 1 } },
    });
    const response = await server.handler(new Request("https://host.test/api/tailorkit/schema"), {
      authenticate: () => null,
    });
    expect(response.ok).toBe(true);
    const output = renderGeneratedTypes(await response.json());
    expect(output).toContain("increment: (input: string) => Promise<number>;");
  });

  it("generates typed action callers without request context", () => {
    const output = renderGeneratedTypes({
      tools: {
        todo: {
          create: {
            kind: "server",
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

    expect(output).toContain("export type TailorKitTools = {");
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
    slots: {
      panel: { views: ["/", "/users", "/users/detail"], multiple: true },
      navbar: { views: ["/"] },
    },
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
    'interface TailorKitSlots { "panel": { views: "/" | "/users" | "/users/detail"; multiple: true }; "navbar": { views: "/"; multiple: false }; }',
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
    views: {
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
it("generates both frontend kinds and excludes client namespaces from backend callers", () => {
  const generated = renderGeneratedTypes({
    tools: {
      ui: { open: { kind: "client", input: { type: "string" }, output: { type: "boolean" } } },
      accounts: { nested: { balance: { kind: "server", output: { type: "number" } } } },
    },
  });
  expect(generated).toContain('callTool("client", "ui.open", input)');
  expect(generated).toContain('callTool("server", "accounts.nested.balance", input)');
  const backend = generated.slice(
    generated.indexOf("export type TailorKitBackendTools"),
    generated.indexOf('declare module "tailorkit/client" { interface TailorKitServerTools'),
  );
  expect(backend).not.toContain("ui:");
  expect(backend).toContain("balance: (input?: undefined) => Promise<number>");
});
