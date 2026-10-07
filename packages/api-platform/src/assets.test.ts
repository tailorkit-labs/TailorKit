import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { maxDeploymentBytes } from "@tailorkit/asset-delivery";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Storage } from "@tailorkit/storage";
import { handleAssetRequest } from "./assets";

const teamId = "abc123def45678";
const projectId = "22222222-2222-4222-8222-222222222222";
const appId = "app000000001";
const deploymentId = "deploy000001";
const url = `http://localhost:3000/api/assets/t/${teamId}/p/${projectId}/a/${appId}/d/${deploymentId}/client/client.js`;
const key = `teams/${teamId}/projects/${projectId}/apps/${appId}/deployments/${deploymentId}/client/client.js`;
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
  it("rejects every server bundle URL before accessing private storage", async () => {
    const backend = storage();
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const suffix of [
      "server.js",
      "server/server.js",
      "client/server.js",
      "artifact.json",
      "migration.sql",
    ]) {
      for (const method of ["GET", "HEAD", "OPTIONS"]) {
        const response = await handleAssetRequest(
          new Request(url.replace("client.js", suffix), { method }),
          backend,
        );
        expect(response.status).toBe(404);
      }
    }
    expect(backend.head).not.toHaveBeenCalled();
    expect(backend.createDownloadUrl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

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

  it("returns not found without falling back to retired storage paths", async () => {
    const backend = storage();
    vi.mocked(backend.head).mockRejectedValueOnce({ name: "NoSuchKey" });
    const response = await handleAssetRequest(new Request(url), backend);
    expect(response.status).toBe(404);
    expect(backend.head).toHaveBeenCalledExactlyOnceWith({ key });
    expect(backend.createDownloadUrl).not.toHaveBeenCalled();
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

it.each([404, 500])("maps an upstream %s to a public asset failure", async (status) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response("Private upstream details", { status }),
  );
  const response = await handleAssetRequest(new Request(url), storage());
  expect(response.status).toBe(status === 404 ? 404 : 503);
  expect(await response.text()).toBe("");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("maps rejected storage reads to a sanitized service-unavailable response", async () => {
  const backend = storage();
  vi.mocked(backend.head).mockRejectedValueOnce(new Error("Private storage details"));
  const response = await handleAssetRequest(new Request(url), backend);
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("");
});

it("serves Node fetch's decoded gzip body with consistent GET and HEAD metadata", async () => {
  const bytes = gzipSync(bundle);
  const origin = createServer((_request, response) => {
    response.writeHead(200, { "Content-Encoding": "gzip", "Content-Length": bytes.byteLength });
    response.end(bytes);
  });
  await new Promise<void>((resolve, reject) => {
    origin.once("error", reject);
    origin.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = origin.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const backend = storage();
    vi.mocked(backend.head).mockResolvedValue({
      key,
      contentEncoding: "gzip",
      contentLength: bytes.byteLength,
      contentType: "application/javascript",
      etag: '"gzip-etag"',
    });
    vi.mocked(backend.createDownloadUrl).mockResolvedValue({
      key,
      url: `http://127.0.0.1:${address.port}/file`,
    });
    const response = await handleAssetRequest(new Request(url), backend);
    expect(await response.text()).toBe(bundle);
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("ETag")).toBe('W/"gzip-etag"');
    const head = await handleAssetRequest(new Request(url, { method: "HEAD" }), backend);
    expect([...head.headers]).toEqual([...response.headers]);
    expect(await head.text()).toBe("");
  } finally {
    await new Promise<void>((resolve, reject) =>
      origin.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("limits decoded gzip assets and cancels the upstream stream on overflow", async () => {
  const backend = storage();
  vi.mocked(backend.head).mockResolvedValue({
    key,
    contentEncoding: "gzip",
    contentLength: 1024,
    contentType: "application/javascript",
  });
  const cancel = vi.fn();
  let chunks = 0;
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(chunks++ === 0 ? maxDeploymentBytes : 1));
        },
        cancel,
      }),
    ),
  );
  const response = await handleAssetRequest(new Request(url), backend);
  const reader = response.body!.getReader();
  expect((await reader.read()).value?.byteLength).toBe(maxDeploymentBytes);
  await expect(reader.read()).rejects.toThrow("Asset delivery failed (404)");
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});

it("serves decoded gzip assets at exactly the 3 MiB limit", async () => {
  const backend = storage();
  vi.mocked(backend.head).mockResolvedValue({
    key,
    contentEncoding: "gzip",
    contentLength: 1024,
    contentType: "application/javascript",
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(new Uint8Array(maxDeploymentBytes)),
  );
  const response = await handleAssetRequest(new Request(url), backend);
  expect((await response.arrayBuffer()).byteLength).toBe(maxDeploymentBytes);
});
