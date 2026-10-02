import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  rename,
  symlink,
  readdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { tailorkitUploadManifestSchema } from "../../app/src/builder/upload-manifest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  build: vi.fn(),
  client: vi.fn(),
  whoami: vi.fn(),
  token: vi.fn(),
  create: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@tailorkit/app/config/loader", () => ({ loadTailorKitConfig: mocks.load }));
vi.mock("@tailorkit/app/builder", () => ({ buildApp: mocks.build, tailorkitUploadManifestSchema }));
vi.mock("@tailorkit/core/server", () => ({ createTailorKitClient: mocks.client }));
vi.mock("./auth", () => ({ getDeployToken: mocks.token, runWhoami: mocks.whoami }));
const { runDeploy } = await import("./deploy");
let root: string;
beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(tmpdir(), "tailorkit-private-deploy-"));
  await mkdir(path.join(root, ".tailorkit/client"), { recursive: true });
  await mkdir(path.join(root, ".tailorkit/server"));
  await mkdir(path.join(root, ".tailorkit/migrations"));
  await writeFile(path.join(root, ".tailorkit/client/client.js"), "client-code");
  await writeFile(path.join(root, ".tailorkit/server/server.js"), "server-code");
  await writeFile(path.join(root, ".tailorkit/migrations/migration.sql"), "DO NOT UPLOAD");
  await writeFile(
    path.join(root, ".tailorkit/tailorkit-upload.json"),
    JSON.stringify({
      version: 1,
      assets: { client: "client/client.js", server: "server/server.js" },
    }),
  );
  mocks.load.mockResolvedValue({
    root,
    filepath: path.join(root, "tailorkit.config.ts"),
    config: { appId: "app-one", server: {} },
  });
  mocks.whoami.mockResolvedValue({ hostUrl: "https://host.example" });
  mocks.token.mockResolvedValue({ deployToken: "deploy-token" });
  mocks.client.mockReturnValue({ deployments: { create: mocks.create, publish: mocks.publish } });
  mocks.create.mockResolvedValue({
    deployment: { id: "deployment" },
    assets: [{ uploadUrl: "https://uploads.example/client" }],
    server: { uploadUrl: "https://uploads.example/server" },
  });
  mocks.publish.mockResolvedValue({ id: "deployment", status: "published" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("uploads server and client code without a provisioned Worker or migration upload", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 200 }));
  await runDeploy({ cwd: root });
  expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
    assets: [{ objectKey: "client.js" }],
    server: { objectKey: "server.js" },
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  const uploaded = fetch.mock.calls.map(([url, options]) => ({
    url: String(url),
    code: new TextDecoder().decode(options?.body as Uint8Array),
  }));
  expect(uploaded).toContainEqual({ url: "https://uploads.example/server", code: "server-code" });
  expect(uploaded).toContainEqual({ url: "https://uploads.example/client", code: "client-code" });
  expect(mocks.publish).toHaveBeenCalledOnce();
});

it.each([
  { name: "config", annotation: "", prelude: "" },
  { name: "$config", annotation: "", prelude: "" },
  { name: "config", annotation: ": TailorKitConfig", prelude: "" },
  { name: "config", annotation: ": TailorKitConfig & { callback?: () => void }", prelude: "" },
  {
    name: "config",
    annotation: "",
    prelude: 'function nested() {\nconst config = {\n  host: "https://nested.example",\n};\n}\n',
  },
  {
    name: "config",
    annotation: ": TailorKitConfig",
    prelude:
      'function nested() {\nconst config: TailorKitConfig = {\n  host: "https://nested.example",\n};\n}\n',
  },
])(
  "links the init config exported as $name with annotation '$annotation' and prelude '$prelude'",
  async ({ name, annotation, prelude }) => {
    const template = await readFile(
      path.join(import.meta.dirname, "generator/templates/tailorkit.config.ts.liquid"),
      "utf-8",
    );
    const source =
      prelude +
      template
        .replace("{{ hostUrl }}", "https://host.example")
        .replace("const config =", `const ${name}${annotation} =`)
        .replace("export default config;", `export default ${name};`);
    const configPath = path.join(root, "tailorkit.config.ts");
    await writeFile(configPath, source);
    mocks.load.mockResolvedValue({ root, filepath: configPath, config: { server: {} } });
    const createApp = vi.fn().mockResolvedValue({ id: "new-app-id" });
    mocks.client.mockReturnValue({
      apps: { create: createApp },
      deployments: { create: mocks.create, publish: mocks.publish },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    const result = await runDeploy({ cwd: root, onMissingAppId: async () => true });

    expect(await readFile(configPath, "utf-8")).toBe(
      source.replace(
        `const ${name}${annotation} = {\n  host: "https://host.example"`,
        `const ${name}${annotation} = {\n  appId: "new-app-id",\n  host: "https://host.example"`,
      ),
    );
    expect(result).toMatchObject({ appId: "new-app-id", createdApp: true });
    expect(createApp).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({ appId: "new-app-id" });
    expect(mocks.publish).toHaveBeenCalledOnce();
  },
);

it("preserves client-only deployment uploads", async () => {
  await writeFile(
    path.join(root, ".tailorkit/tailorkit-upload.json"),
    JSON.stringify({ version: 1, assets: { client: "client/client.js" } }),
  );
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 200 }));
  await runDeploy({ cwd: root });
  expect(mocks.create.mock.calls[0]?.[0].server).toBeUndefined();
  expect(fetch).toHaveBeenCalledOnce();
});

it("typechecks the configured client entry before uploading", async () => {
  await symlink(
    path.resolve(import.meta.dirname, "../../../examples/apps/backend-todo/node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  await mkdir(path.join(root, "ui"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/server.ts"), "export default {};\n");
  await writeFile(path.join(root, "ui/browser.ts"), "export default {};\n");
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        types: [],
      },
    }),
  );
  mocks.load.mockResolvedValue({
    root,
    filepath: path.join(root, "tailorkit.config.ts"),
    config: { appId: "app-one", server: {}, client: { entry: "./ui/browser.ts" } },
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  await runDeploy({ cwd: root });
  expect(mocks.publish).toHaveBeenCalledOnce();
  mocks.publish.mockClear();
  await writeFile(
    path.join(root, "ui/browser.ts"),
    "const label: string = 42;\nexport default label;\n",
  );
  const onTypecheckFailed = vi.fn().mockResolvedValue(false);
  await expect(runDeploy({ cwd: root, onTypecheckFailed })).rejects.toThrow("type check failed");
  expect(onTypecheckFailed).toHaveBeenCalledWith(
    expect.objectContaining({
      command: "tsc --noEmit ui/browser.ts",
      exitCode: expect.any(Number),
      output: expect.stringContaining("ui/browser.ts"),
    }),
  );
  expect(mocks.publish).not.toHaveBeenCalled();
  expect((await readdir(root)).some((file) => file.startsWith(".tailorkit-typecheck-"))).toBe(
    false,
  );
});

it("typechecks the server entry even when the client does not import it", async () => {
  await symlink(
    path.resolve(import.meta.dirname, "../../../examples/apps/backend-todo/node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/client.ts"), "export default {};\n");
  await writeFile(path.join(root, "src/server.ts"), 'export const invalid: number = "string";');
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { types: [], skipLibCheck: true } }),
  );
  const onTypecheckFailed = vi.fn().mockResolvedValue(false);
  await expect(runDeploy({ cwd: root, onTypecheckFailed })).rejects.toThrow("type check failed");
  expect(onTypecheckFailed.mock.calls[0]?.[0].output).toContain("src/server.ts");
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("does not publish when the server upload fails", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
    Promise.resolve(new Response(null, { status: String(url).endsWith("server") ? 403 : 200 })),
  );
  await expect(runDeploy({ cwd: root })).rejects.toThrow("Asset upload failed");
  expect(mocks.publish).not.toHaveBeenCalled();
});

it.each(["config", "option"])(
  "uploads all artifacts from a custom %s output directory",
  async (mode) => {
    await writeFile(path.join(root, ".tailorkit/server/server.js"), "new-backend-code");
    await rename(path.join(root, ".tailorkit"), path.join(root, "output"));
    mocks.load.mockResolvedValue({
      root,
      filepath: path.join(root, "tailorkit.config.ts"),
      config: {
        appId: "app-one",
        server: {},
        build: { outDir: mode === "config" ? "output" : ".tailorkit" },
      },
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    await runDeploy({ cwd: root, ...(mode === "option" ? { outDir: "output" } : {}) });
    const server = fetch.mock.calls.find(([url]) => String(url).endsWith("server"));
    expect(new TextDecoder().decode(server?.[1]?.body as Uint8Array)).toBe("new-backend-code");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.publish).toHaveBeenCalledOnce();
  },
);
