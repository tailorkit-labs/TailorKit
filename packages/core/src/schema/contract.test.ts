import { expect, it } from "vite-plus/test";
import { z } from "zod";
import * as mini from "zod/mini";
import * as v from "valibot";
import { type } from "arktype";
import { action, defineContract } from "./contract";

it("keeps reusable action builders immutable", () => {
  const base = action().input(z.object({ id: z.string() }));
  const first = base.output(z.string());
  const second = base.output(z.number());
  expect(base.definition.output).toBeUndefined();
  expect(first.definition.output).not.toBe(second.definition.output);
  expect(first.definition.input).toBe(base.definition.input);
  expect("handler" in first).toBe(false);
});

it("provides empty definitions without loading a validator or serializing schemas", () => {
  expect(defineContract({})).toEqual({
    components: {},
    views: {},
    slots: {},
    actions: {},
    scopes: {},
  });
});

it("rejects undeclared slot views at runtime", () => {
  expect(() =>
    defineContract({
      // @ts-expect-error slots must reference declared views
      slots: { page: { views: ["/missing"] } },
    }),
  ).toThrow('references undeclared view "/missing"');
});

it("preserves native stripping through Standard Schema for Zod, Mini, Valibot and ArkType", async () => {
  for (const schema of [
    z.object({ user: z.object({ id: z.string() }) }),
    mini.object({ user: mini.object({ id: mini.string() }) }),
    v.object({ user: v.object({ id: v.string() }) }),
    type({ user: { id: "string" } }).onDeepUndeclaredKey("delete"),
  ]) {
    const contract = defineContract({ views: { "/": schema } });
    const input = { user: { id: "u1", email: "private@example.com" }, extra: true };
    const result = await contract.views["/"]["~standard"].validate(input);
    expect(result).toMatchObject({ value: { user: { id: "u1" } } });
    expect(input.user.email).toBe("private@example.com");
  }
});

it("bundles the public contract entry without server code or a built-in validator", async () => {
  const { build } = await import("vite-plus");
  const { fileURLToPath } = await import("node:url");
  const modules: string[] = [];
  await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "contract-boundary",
        generateBundle() {
          modules.push(...this.getModuleIds());
        },
      },
    ],
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(new URL("../../../tailorkit/src/index.ts", import.meta.url)),
        formats: ["es"],
      },
    },
  });
  expect(modules.some((id) => /\/(?:zod|arktype|valibot)\//u.test(id))).toBe(false);
  expect(modules.some((id) => /\/(?:core\/dist\/server|@orpc\/server)/u.test(id))).toBe(false);
});
