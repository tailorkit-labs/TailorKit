import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Storage } from "@tailorkit/storage";
import { handleAssetRequest } from "./assets";

const teamId = "abc123def45678";
const projectId = "22222222-2222-4222-8222-222222222222";
const appId = "app000000001";
const deploymentId = "deploy000001";
const url = `http://localhost:3000/api/assets/t/${teamId}/p/${projectId}/a/${appId}/d/${deploymentId}/client.js`;
const key = `teams/${teamId}/projects/${projectId}/apps/${appId}/deployments/${deploymentId}/files/client.js`;
const bundle = "export default 'local asset';";

function storage(): Storage {
  return {
    type: "s3",
    head: vi.fn().mockResolvedValue({
      key,
      contentLength: new TextEncoder().encode(bundle).byteLength,
      contentType: "application/javascript",
      etag: '"asset-etag"',
    }),
    createDownloadUrl: vi.fn().mockResolvedValue({ key, url: "http://127.0.0.1:8333/file" }),
    createUploadUrl: vi.fn(),
    delete: vi.fn(),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Node asset delivery", () => {
  it("streams a valid object with browser-safe headers", async () => {
    const backend = storage();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(bundle));
    const response = await handleAssetRequest(new Request(url), backend);
    expect(backend.head).toHaveBeenCalledWith({ key });
    expect(await response.text()).toBe(bundle);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(response.headers.get("ETag")).toBe('"asset-etag"');
  });

  it("serves HEAD and OPTIONS without downloading the object", async () => {
    const backend = storage();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const head = await handleAssetRequest(new Request(url, { method: "HEAD" }), backend);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const options = await handleAssetRequest(new Request(url, { method: "OPTIONS" }), backend);
    expect(options.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed paths, unsupported methods and missing storage", async () => {
    await expect(
      handleAssetRequest(new Request(`${url}?token=secret`), storage()),
    ).resolves.toHaveProperty("status", 404);
    await expect(
      handleAssetRequest(new Request(url, { method: "POST" }), storage()),
    ).resolves.toHaveProperty("status", 405);
    await expect(handleAssetRequest(new Request(url), null)).resolves.toHaveProperty("status", 503);
  });
});
