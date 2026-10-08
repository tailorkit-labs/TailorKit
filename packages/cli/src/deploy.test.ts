import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
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
import { NotLoggedInError } from "./auth";
import { tailorkitUploadManifestSchema } from "../../app/src/builder/upload-manifest";
import { getClientSourceFiles } from "../../app/src/builder/file-routes";

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
vi.mock("@tailorkit/app/builder", () => ({
  buildApp: mocks.build,
  tailorkitUploadManifestSchema,
  getClientSourceFiles,
}));
vi.mock("@tailorkit/core/server", () => ({ createTailorKitClient: mocks.client }));
vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth")>()),
  getDeployToken: mocks.token,
  runWhoami: mocks.whoami,
}));
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
      views: [
        { slot: "page", path: "/", instances: true },
        { slot: "page", path: "/disabled", disabled: true },
      ],
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

it("uploads gzip server and client code with metadata matching the stored bytes", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 200 }));
  await runDeploy({ cwd: root });
  expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
    assets: [{ objectKey: "client.js" }],
    views: [
      { slot: "page", path: "/", instances: true },
      { slot: "page", path: "/disabled", disabled: true },
    ],
    server: { objectKey: "server.js" },
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  const uploaded = fetch.mock.calls.map(([url, options]) => ({
    url: String(url),
    code: gunzipSync(options?.body as Uint8Array).toString("utf-8"),
  }));
  expect(uploaded).toContainEqual({ url: "https://uploads.example/server", code: "server-code" });
  expect(uploaded).toContainEqual({ url: "https://uploads.example/client", code: "client-code" });
  for (const [uploadUrl, options] of fetch.mock.calls) {
    const bytes = options?.body as Uint8Array;
    const metadata = String(uploadUrl).endsWith("server")
      ? mocks.create.mock.calls[0]?.[0].server
      : mocks.create.mock.calls[0]?.[0].assets[0];
    expect(metadata).toMatchObject({
      checksum: createHash("sha256").update(bytes).digest("hex"),
      contentLength: bytes.byteLength,
      encoding: "gzip",
    });
    expect(new Headers(options?.headers).get("Content-Encoding")).toBe("gzip");
  }
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

it("typechecks file route roots, layouts and views without a manual client entry", async () => {
  await symlink(
    path.resolve(import.meta.dirname, "../../../examples/apps/backend-todo/node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  await mkdir(path.join(root, "src/slots/panel"), { recursive: true });
  await writeFile(path.join(root, "src/server.ts"), "export default {};\n");
  const sources = [
    "src/root.tsx",
    "src/slots/panel/root.tsx",
    "src/slots/panel/layout.tsx",
    "src/slots/panel/home.view.tsx",
  ];
  for (const file of sources) {
    await writeFile(path.join(root, file), "export default null;\n");
  }
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        types: [],
        jsx: "react-jsx",
        jsxImportSource: "preact",
      },
    }),
  );
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  await runDeploy({ cwd: root });
  expect(mocks.publish).toHaveBeenCalledOnce();
  mocks.publish.mockClear();
  for (const file of sources) {
    await writeFile(path.join(root, file), "const label: string = 42; export default label;\n");
    const onTypecheckFailed = vi.fn().mockResolvedValue(false);
    await expect(runDeploy({ cwd: root, onTypecheckFailed })).rejects.toThrow("type check failed");
    expect(onTypecheckFailed.mock.calls[0]?.[0].output).toContain(file);
    expect(mocks.publish).not.toHaveBeenCalled();
    await writeFile(path.join(root, file), "export default null;\n");
  }
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
    expect(gunzipSync(server?.[1]?.body as Uint8Array).toString("utf-8")).toBe("new-backend-code");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.publish).toHaveBeenCalledOnce();
  },
);

it.each(["missing", "expired"])(
  "logs in with %s credentials and continues deploying with the new token",
  async (credentials) => {
    mocks.whoami.mockRejectedValue(new NotLoggedInError("https://host.example"));
    mocks.token.mockResolvedValue(
      credentials === "missing" ? undefined : { deployToken: "expired-token" },
    );
    const onLoginRequired = vi.fn().mockImplementation(async () => {
      expect(mocks.build).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
      mocks.token.mockResolvedValue({ deployToken: "new-token" });
      return { hostUrl: "https://host.example" };
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      runDeploy({ cwd: root, configPath: "custom.config.ts", onLoginRequired }),
    ).resolves.toMatchObject({ deploymentId: "deployment", status: "published" });
    expect(mocks.whoami).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: root, configPath: "custom.config.ts" }),
    );
    expect(onLoginRequired).toHaveBeenCalledOnce();
    expect(mocks.token).toHaveBeenCalledWith("https://host.example");
    expect(mocks.client).toHaveBeenCalledWith({
      headers: { authorization: "Bearer new-token" },
      url: "https://host.example",
    });
    expect(mocks.publish).toHaveBeenCalledOnce();
  },
);

it("skips the login flow when already authenticated", async () => {
  const onLoginRequired = vi.fn();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  await runDeploy({ cwd: root, onLoginRequired });
  expect(onLoginRequired).not.toHaveBeenCalled();
  expect(mocks.publish).toHaveBeenCalledOnce();
});

it.each(["CLI login was denied.", "Timed out waiting for CLI login approval."])(
  "stops deploying when login fails: %s",
  async (message) => {
    mocks.whoami.mockRejectedValue(new NotLoggedInError("https://host.example"));
    const onLoginRequired = vi.fn().mockRejectedValue(new Error(message));
    await expect(runDeploy({ cwd: root, onLoginRequired })).rejects.toThrow(message);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  },
);

it("does not start login for config or credential store errors", async () => {
  mocks.whoami.mockRejectedValue(new Error("Invalid auth.json"));
  const onLoginRequired = vi.fn();
  await expect(runDeploy({ cwd: root, onLoginRequired })).rejects.toThrow("Invalid auth.json");
  expect(onLoginRequired).not.toHaveBeenCalled();
  expect(mocks.build).not.toHaveBeenCalled();
});

it.each(["client", "server"])(
  "rejects oversized raw %s code before creating a deployment",
  async (kind) => {
    await writeFile(
      path.join(root, `.tailorkit/${kind}/${kind}.js`),
      "x".repeat(3 * 1024 * 1024 + 1),
    );
    await expect(runDeploy({ cwd: root })).rejects.toThrow(/exceed/u);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  },
);

it("preserves signed upload headers and uploads logos without gzip encoding", async () => {
  const logo = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  await writeFile(path.join(root, ".tailorkit/client/logo-light.svg"), logo);
  const manifestPath = path.join(root, ".tailorkit/tailorkit-upload.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  manifest.assets.logos = { light: "client/logo-light.svg" };
  await writeFile(manifestPath, JSON.stringify(manifest));
  mocks.create.mockResolvedValue({
    deployment: { id: "deployment" },
    assets: [
      {
        uploadUrl: "https://uploads.example/client",
        headers: { "x-amz-checksum-sha256": "signed-client", "content-encoding": "gzip" },
      },
    ],
    server: { uploadUrl: "https://uploads.example/server" },
    logos: {
      light: {
        uploadUrl: "https://uploads.example/logo",
        headers: { "content-type": "image/svg+xml" },
      },
    },
  });
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 200 }));
  await runDeploy({ cwd: root });
  const clientUpload = fetch.mock.calls.find(([url]) => String(url).endsWith("client"));
  expect(new Headers(clientUpload?.[1]?.headers).get("x-amz-checksum-sha256")).toBe(
    "signed-client",
  );
  const logoUpload = fetch.mock.calls.find(([url]) => String(url).endsWith("logo"));
  expect(new TextDecoder().decode(logoUpload?.[1]?.body as Uint8Array)).toBe(logo);
  expect(new Headers(logoUpload?.[1]?.headers).get("content-encoding")).toBeNull();
});

it.each(["client", "server"])("accepts %s code exactly at the 3 MiB limit", async (kind) => {
  const size = 3 * 1024 * 1024;
  await writeFile(path.join(root, `.tailorkit/${kind}/${kind}.js`), "x".repeat(size));
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  const result = await runDeploy({ cwd: root });
  expect(result.uploadedFiles).toContainEqual(
    expect.objectContaining({ path: `${kind}/${kind}.js`, size }),
  );
  expect(mocks.publish).toHaveBeenCalledOnce();
});
