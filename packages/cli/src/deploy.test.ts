import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  await mkdir(path.join(root, ".tailorkit"));
  await mkdir(path.join(root, ".tailorkit-storage"));
  await writeFile(path.join(root, ".tailorkit/client.js"), "client-code");
  await writeFile(path.join(root, ".tailorkit-storage/server.js"), "server-code");
  await writeFile(path.join(root, ".tailorkit-storage/migrations.json"), "DO NOT UPLOAD");
  await writeFile(
    path.join(root, ".tailorkit/tailorkit-upload.json"),
    JSON.stringify({ version: 1, assets: { client: "client.js", server: "server.js" } }),
  );
  mocks.load.mockResolvedValue({
    root,
    filepath: path.join(root, "tailorkit.config.ts"),
    config: { appId: "app-one", storage: {} },
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

it("preserves client-only deployment uploads", async () => {
  await writeFile(
    path.join(root, ".tailorkit/tailorkit-upload.json"),
    JSON.stringify({ version: 1, assets: { client: "client.js" } }),
  );
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 200 }));
  await runDeploy({ cwd: root });
  expect(mocks.create.mock.calls[0]?.[0].server).toBeUndefined();
  expect(fetch).toHaveBeenCalledOnce();
});

it("does not publish when the server upload fails", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (url) => new Response(null, { status: String(url).endsWith("server") ? 403 : 200 }),
  );
  await expect(runDeploy({ cwd: root })).rejects.toThrow("Asset upload failed");
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("uploads the new apps-server artifact from its separate build directory", async () => {
  await mkdir(path.join(root, ".tailorkit-server"));
  await writeFile(path.join(root, ".tailorkit-server/server.js"), "new-backend-code");
  mocks.load.mockResolvedValue({
    root,
    filepath: path.join(root, "tailorkit.config.ts"),
    config: { appId: "app-one", server: { entry: "src/server.ts" } },
  });
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 200 }));
  await runDeploy({ cwd: root });
  const server = fetch.mock.calls.find(([url]) => String(url).endsWith("server"));
  expect(new TextDecoder().decode(server?.[1]?.body as Uint8Array)).toBe("new-backend-code");
  expect(mocks.publish).toHaveBeenCalledOnce();
});
