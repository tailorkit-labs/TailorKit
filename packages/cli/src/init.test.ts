import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { runInit } from "./init";

vi.mock("./generator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./generator")>()),
  resolveTemplatePackageVersions: async () => ({
    oxfmt: "0.71.0",
    oxlint: "1.86.0",
    preact: "11.0.0",
    tailorkit: "0.1.0-beta.16",
    typescript: "6.0.3",
  }),
}));
vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function initOptions() {
  const cwd = await mkdtemp(path.join(tmpdir(), "tailorkit-init-"));
  directories.push(cwd);
  return {
    cwd,
    name: "example",
    host: "https://host.test/api/tailorkit",
    packageManager: "pnpm",
    install: false,
    formatting: false,
    linting: false,
  };
}

it("fetches the host schema and generates real bindings even when installation is skipped", async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      slots: { sidebar: { views: ["/people"] } },
      views: {
        "/people": { context: { type: "object", properties: { customer: { type: "string" } } } },
      },
      components: { Box: { children: true, callbacks: {} } },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const directory = await runInit(await initOptions());
  expect(fetch).toHaveBeenCalledExactlyOnceWith("https://host.test/api/tailorkit/schema", {
    signal: undefined,
  });
  const bindings = await readFile(path.join(directory, "src/tailorkit.gen.ts"), "utf-8");
  expect(bindings).toContain('"sidebar": { views: "/people"; multiple: false }');
  expect(bindings).toContain("customer?: string");
  expect(bindings).not.toContain("Card");
  expect(
    await readFile(path.join(directory, "src/slots/sidebar/people.view.tsx"), "utf-8"),
  ).toContain("<Box>");
  expect(await readFile(path.join(directory, "src/root.tsx"), "utf-8")).toContain(
    "shellComponent: Shell",
  );
});

it("reports schema fetch failures without creating a project", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response("Unavailable", { status: 503, statusText: "Service Unavailable" }),
    ),
  );
  const options = await initOptions();
  await expect(runInit(options)).rejects.toThrow("Unable to fetch TailorKit schema");
  await expect(stat(path.join(options.cwd, options.name))).rejects.toThrow();
});

it("scaffolds and regenerates from a schema file while the local host is unreachable", async () => {
  const options = {
    ...(await initOptions()),
    host: "http://localhost:3000/api/tailorkit",
    schemaPath: "schema.json",
  };
  const schema = {
    version: 1,
    components: { Box: { children: true, callbacks: {} } },
    views: { "/local": { context: { type: "object", properties: { name: { type: "string" } } } } },
    slots: { sidebar: { views: ["/local"] } },
    tools: {},
  };
  await writeFile(path.join(options.cwd, "schema.json"), JSON.stringify(schema));
  const fetch = vi.fn(() => {
    throw new Error("Host is unreachable");
  });
  vi.stubGlobal("fetch", fetch);
  const directory = await runInit(options);
  const generated = path.join(directory, "src/tailorkit.gen.ts");
  const initial = await readFile(generated, "utf-8");
  expect(initial).toContain('"sidebar": { views: "/local"; multiple: false }');
  expect(initial).toContain("name?: string");
  expect(await readFile(path.join(directory, "tailorkit.config.ts"), "utf-8")).toContain(
    options.host,
  );
  await rm(generated);
  const { generateTypes } = await import("./generator/types");
  await generateTypes({ cwd: directory, schemaPath: "../schema.json" });
  expect(await readFile(generated, "utf-8")).toBe(initial);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["{", "null", "{}", '{"version":2,"components":{}}'])(
  "rejects invalid schema file %s without fetching or creating a project",
  async (content) => {
    const options = { ...(await initOptions()), schemaPath: "schema.json" };
    await writeFile(path.join(options.cwd, "schema.json"), content);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(runInit(options)).rejects.toThrow("Unable to read TailorKit schema");
    expect(fetch).not.toHaveBeenCalled();
    await expect(stat(path.join(options.cwd, options.name))).rejects.toThrow();
  },
);
