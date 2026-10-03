import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { generateApp } from "./generate";
import type { TailorKitSchemaFile } from "./types";

const testDirectories: string[] = [];

const createTempDir = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "tailorkit-generator-"));
  testDirectories.push(directory);
  return directory;
};

const defaultOptions = {
  force: false,
  formatting: false,
  hostUrl: "https://host.example.com/api/tailorkit",
  schema: {
    slots: { sidebar: { views: ["/customers"] } },
    views: {
      "/customers": { context: { type: "object", properties: { customer: { type: "string" } } } },
    },
    components: {
      Box: { children: true, fields: { type: "object", properties: {} }, callbacks: {} },
    },
  },
  linting: false,
  packageName: "test-app",
  packageVersions: {
    oxfmt: "1.0.0",
    oxlint: "1.0.0",
    preact: "10.0.0",
    tailorkit: "4.5.6",
    typescript: "5.0.0",
  },
  useWorkspaceDependencies: false,
} as const;

afterEach(async () => {
  for (const directory of testDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("generateApp", () => {
  it("generates all expected files", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const files = [
      "package.json",
      "tsconfig.json",
      "tailorkit.config.ts",
      "logo-dark.svg",
      "logo-light.svg",
      ".gitignore",
      path.join("src", "client.ts"),
      path.join("src", "views", "default.tsx"),
      path.join("src", "tailorkit.gen.ts"),
      path.join("src", "server.ts"),
      path.join("src", "schema.ts"),
      path.join("src", "functions", "greeting.ts"),
    ];

    for (const file of files) {
      await expect(readFile(path.join(targetDirectory, file), "utf-8")).resolves.toBeDefined();
    }
  });

  it("does not generate linting or formatting configs when disabled", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    await expect(
      readFile(path.join(targetDirectory, "oxlint.config.ts"), "utf-8"),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(targetDirectory, "oxfmt.config.ts"), "utf-8"),
    ).rejects.toThrow();
  });

  it("generates oxlint config when linting is enabled", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory, linting: true });

    const content = await readFile(path.join(targetDirectory, "oxlint.config.ts"), "utf-8");
    expect(content).toContain("ignorePatterns");
    expect(content).toContain("src/tailorkit.gen.ts");
  });

  it("generates oxfmt config when formatting is enabled", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory, formatting: true });

    const content = await readFile(path.join(targetDirectory, "oxfmt.config.ts"), "utf-8");
    expect(content).toContain("ignorePatterns");
    expect(content).toContain("src/tailorkit.gen.ts");
  });

  it("throws when a file exists and force is false", async () => {
    const targetDirectory = await createTempDir();
    await writeFile(path.join(targetDirectory, "package.json"), "{}", "utf-8");

    await expect(generateApp({ ...defaultOptions, targetDirectory })).rejects.toThrow(
      "already exists. Use --force to overwrite it.",
    );
  });

  it("overwrites existing files when force is true", async () => {
    const targetDirectory = await createTempDir();
    await writeFile(path.join(targetDirectory, "package.json"), "{}", "utf-8");

    await expect(
      generateApp({ ...defaultOptions, targetDirectory, force: true }),
    ).resolves.toBeUndefined();

    const content = await readFile(path.join(targetDirectory, "package.json"), "utf-8");
    expect(content).toContain("test-app");
  });

  it("uses workspace dependency version when useWorkspaceDependencies is true", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory, useWorkspaceDependencies: true });

    const content = await readFile(path.join(targetDirectory, "package.json"), "utf-8");
    expect(content).toContain('"tailorkit": "workspace:*"');
    expect(content).not.toContain("@tailorkit/cli");
  });

  it("uses resolved dependency versions when useWorkspaceDependencies is false", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory, useWorkspaceDependencies: false });

    const content = await readFile(path.join(targetDirectory, "package.json"), "utf-8");
    expect(content).toContain('"tailorkit": "4.5.6"');
    expect(content).not.toContain("@tailorkit/cli");
  });

  it("includes lint and format scripts when both are enabled", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({
      ...defaultOptions,
      targetDirectory,
      linting: true,
      formatting: true,
    });

    const content = await readFile(path.join(targetDirectory, "package.json"), "utf-8");
    expect(content).toContain('"lint": "oxlint"');
    expect(content).toContain('"lint:fix": "oxlint --fix"');
    expect(content).toContain('"format": "oxfmt --check"');
    expect(content).toContain('"format:fix": "oxfmt --write"');
    expect(content).toContain('"check": "pnpm run lint && pnpm run format"');
    expect(content).toContain('"fix": "pnpm run lint:fix && pnpm run format:fix"');
  });

  it("includes only lint scripts when only linting is enabled", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory, linting: true });

    const content = await readFile(path.join(targetDirectory, "package.json"), "utf-8");
    expect(content).toContain('"lint": "oxlint"');
    expect(content).toContain('"lint:fix": "oxlint --fix"');
    expect(content).not.toContain('"format":');
    expect(content).toContain('"check": "pnpm run lint"');
    expect(content).toContain('"fix": "pnpm run lint:fix"');
  });

  it("includes only format scripts when only formatting is enabled", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory, formatting: true });

    const content = await readFile(path.join(targetDirectory, "package.json"), "utf-8");
    expect(content).not.toContain('"lint":');
    expect(content).toContain('"format": "oxfmt --check"');
    expect(content).toContain('"format:fix": "oxfmt --write"');
    expect(content).toContain('"check": "pnpm run format"');
    expect(content).toContain('"fix": "pnpm run format:fix"');
  });

  it("renders package versions into package.json", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(path.join(targetDirectory, "package.json"), "utf-8");
    expect(content).toContain('"preact": "10.0.0"');
    expect(content).toContain('"typescript": "5.0.0"');
  });

  it("renders the package name into package.json", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory, packageName: "my-custom-app" });

    const content = await readFile(path.join(targetDirectory, "package.json"), "utf-8");
    expect(content).toContain('"name": "my-custom-app"');
  });

  it("generates a valid tailorkit.config.ts", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(path.join(targetDirectory, "tailorkit.config.ts"), "utf-8");
    expect(content).toContain('import type { TailorKitConfig } from "tailorkit/app/config"');
    expect(content).toContain("satisfies TailorKitConfig");
    expect(content).toContain('host: "https://host.example.com/api/tailorkit"');
    expect(content).toContain('dark: "logo-dark.svg"');
    expect(content).toContain('light: "logo-light.svg"');
    expect(content).not.toContain("defineTailorKitConfig");
  });

  it("generates TailorKit logos for both themes", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    for (const variant of ["dark", "light"]) {
      const content = await readFile(path.join(targetDirectory, `logo-${variant}.svg`), "utf-8");
      const brandMark = await readFile(
        new URL(`../../../../apps/web/public/brand/mark-${variant}.svg`, import.meta.url),
        "utf-8",
      );
      expect(content).toBe(brandMark);
    }
  });

  it("protects existing logos unless force is enabled", async () => {
    for (const variant of ["dark", "light"]) {
      const targetDirectory = await createTempDir();
      const logoPath = path.join(targetDirectory, `logo-${variant}.svg`);
      await writeFile(logoPath, "custom logo", "utf-8");

      await expect(generateApp({ ...defaultOptions, targetDirectory })).rejects.toThrow(
        "already exists. Use --force to overwrite it.",
      );
      expect(await readFile(logoPath, "utf-8")).toBe("custom logo");

      await generateApp({ ...defaultOptions, targetDirectory, force: true });
      expect(await readFile(logoPath, "utf-8")).toContain("<svg");
    }
  });

  it("generates a default view for the host schema", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(
      path.join(targetDirectory, "src", "views", "default.tsx"),
      "utf-8",
    );
    expect(content).toContain('createView("/customers", {');
    expect(content).not.toContain("context.user");
    expect(content).toContain("<Box>");
  });

  it("generates a client entry with the default view", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(path.join(targetDirectory, "src", "client.ts"), "utf-8");
    expect(content).toContain('import { ClientProvider, defineClient } from "tailorkit/client"');
    expect(content).toContain("component: ClientProvider");
    expect(content).toContain('import defaultView from "./views/default"');
    expect(content).toContain("defineClient");
    expect(content).toContain('"/customers": defaultView');
    expect(content).not.toContain("fallbackView");
  });

  it("does not generate fallback view props for the host schema", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(path.join(targetDirectory, "src", "tailorkit.gen.ts"), "utf-8");
    expect(content).not.toContain("FallbackViewProps");
    expect(content).not.toContain("DefaultViewProps");
  });

  it("generates a valid generated types file", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(path.join(targetDirectory, "src", "tailorkit.gen.ts"), "utf-8");
    expect(content).toContain('import { createRemoteComponent } from "tailorkit/client"');
    expect(content).toContain('import { createApi } from "tailorkit/client"');
    expect(content).toContain('import type app from "./server"');
    expect(content).toContain("export const api = createApi<typeof app.functions>();");
    expect(content).toContain('"/customers": {');
    expect(content).toContain("customer?: string;");
    expect(content).toContain("export const Box");
    expect(content).not.toContain("export const Card");
  });

  it("generates a valid tsconfig.json", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(path.join(targetDirectory, "tsconfig.json"), "utf-8");
    const tsconfig = JSON.parse(content);
    expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
    expect(tsconfig.compilerOptions.jsxImportSource).toBe("preact");
  });

  it("selects the first supported view and slot alphabetically", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({
      ...defaultOptions,
      targetDirectory,
      schema: {
        views: { "/zebra": {}, "/aardvark": {}, "/accounts": {} },
        slots: { zebra: { views: ["/zebra", "/accounts"] }, alpha: { views: ["/accounts"] } },
      },
    });
    const client = await readFile(path.join(targetDirectory, "src/client.ts"), "utf-8");
    const view = await readFile(path.join(targetDirectory, "src/views/default.tsx"), "utf-8");
    expect(client).toContain('"alpha": { "/accounts": defaultView }');
    expect(view).toContain('createView("/accounts", {');
    expect(view).toContain("return <>");
    expect(view).not.toContain("Box");
    expect(view).not.toContain("useContext");
  });

  it.each([
    { children: false, callbacks: {} },
    { children: true, callbacks: {}, fields: { type: "object", required: ["variant"] } },
  ])("uses a fragment when Box cannot wrap the example: %j", async (Box) => {
    const targetDirectory = await createTempDir();
    await generateApp({
      ...defaultOptions,
      targetDirectory,
      schema: { ...defaultOptions.schema, components: { Box } },
    });
    const view = await readFile(path.join(targetDirectory, "src/views/default.tsx"), "utf-8");
    expect(view).toContain("return <>");
    expect(view).not.toContain("Box");
  });

  it.each([
    {},
    { views: { "/accounts": {} }, slots: {} },
    { views: { "/accounts": {} }, slots: { panel: { views: ["/missing"] } } },
  ] as TailorKitSchemaFile[])(
    "rejects hosts without a renderable view before writing files: %j",
    async (schema) => {
      const targetDirectory = await createTempDir();
      await expect(generateApp({ ...defaultOptions, targetDirectory, schema })).rejects.toThrow(
        "no views supported by a slot",
      );
      await expect(readFile(path.join(targetDirectory, "package.json"))).rejects.toThrow();
    },
  );

  it("does not overwrite existing bindings without force", async () => {
    const targetDirectory = await createTempDir();
    await mkdir(path.join(targetDirectory, "src"));
    const bindings = path.join(targetDirectory, "src/tailorkit.gen.ts");
    await writeFile(bindings, "existing bindings");
    await expect(generateApp({ ...defaultOptions, targetDirectory })).rejects.toThrow(
      "already exists",
    );
    expect(await readFile(bindings, "utf-8")).toBe("existing bindings");
  });
});
