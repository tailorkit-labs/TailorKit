import { gzipSync, gunzipSync } from "node:zlib";
import { assetHeaders, maxDeploymentBytes } from "@tailorkit/asset-delivery";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import worker from "./assets";

const projectId = "22222222-2222-4222-8222-222222222222";
const appId = "app000000001";
const deploymentId = "deploy000001";
const path = `/p/${projectId}/a/${appId}/d/${deploymentId}/client/client.js`;
const url = `https://abc123def45678.tailorkit.app${path}`;
const key = `teams/abc123def45678/projects/${projectId}/apps/${appId}/deployments/${deploymentId}/client/client.js`;
const bundle = "export default 'tenant bundle';";
const get = vi.fn();
const head = vi.fn();
const match = vi.fn((_request: Request) => Promise.resolve(undefined as Response | undefined));
const put = vi.fn((_request: Request, _response: Response) => Promise.resolve());
const waitUntil = vi.fn();
const env = { ASSET_DOMAIN: "tailorkit.app", BUNDLES: { get, head } } as unknown as Env;
const ctx = { waitUntil } as unknown as ExecutionContext;

function fetchAsset(request: Request) {
  return worker.fetch(request as Parameters<typeof worker.fetch>[0], env, ctx);
}

function object(body = bundle) {
  return {
    body: new Response(body).body,
    size: new TextEncoder().encode(body).byteLength,
    httpEtag: '"etag"',
    writeHttpMetadata: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("caches", { default: { match, put } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("tenant asset gateway", () => {
  it("never serves server bundles, manifests or migrations publicly", async () => {
    for (const suffix of [
      "server.js",
      "server/server.js",
      "client/server.js",
      "artifact.json",
      "migration.sql",
      "../server/server.js",
    ]) {
      for (const method of ["GET", "HEAD", "OPTIONS"]) {
        const response = await fetchAsset(
          new Request(url.replace("client.js", suffix), { method }),
        );
        expect(response.status).toBe(404);
      }
    }
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
  });

  it("caches an immutable bundle at the edge while preventing downstream caching", async () => {
    get.mockResolvedValueOnce(object());
    const response = await fetchAsset(new Request(url));
    expect(get).toHaveBeenCalledWith(key);
    expect(match.mock.calls[0]?.[0].url).toBe(url);
    expect(put).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(await response.text()).toBe(bundle);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    const cachedResponse = put.mock.calls[0]?.[1];
    expect(cachedResponse?.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(response.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns not found without falling back to retired storage paths", async () => {
    get.mockResolvedValueOnce(null);
    const response = await fetchAsset(new Request(url));
    expect(response.status).toBe(404);
    expect(get).toHaveBeenCalledExactlyOnceWith(key);
  });

  it("serves an edge cache hit without reading R2", async () => {
    match.mockResolvedValueOnce(
      new Response(bundle, {
        headers: assetHeaders({ contentLength: bundle.length, etag: '"cached"' }),
      }),
    );
    const response = await fetchAsset(new Request(url));
    expect(await response.text()).toBe(bundle);
    expect(response.headers.get("ETag")).toBe('"cached"');
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("serves logos with their image content type", async () => {
    get.mockResolvedValueOnce(object("<svg/>"));
    const response = await fetchAsset(
      new Request(url.replace("client/client.js", `logos/${"a".repeat(64)}.svg`)),
    );
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(get).toHaveBeenCalledWith(
      `teams/abc123def45678/projects/${projectId}/apps/${appId}/logos/${"a".repeat(64)}.svg`,
    );
  });

  it("uses the hostname tenant ID as part of the storage namespace", async () => {
    get.mockResolvedValueOnce(object());
    const otherUrl = url.replace("abc123def45678", "xyz123def45678");
    await fetchAsset(new Request(otherUrl));
    expect(get).toHaveBeenCalledWith(key.replace("abc123def45678", "xyz123def45678"));
  });

  it.each(["team-abcdefghi", "a------------z", "0123456789abcd"])(
    "serves bundles for hyphenated team ID %s",
    async (publicId) => {
      get.mockResolvedValueOnce(object());
      const response = await fetchAsset(new Request(url.replace("abc123def45678", publicId)));
      expect(response.status).toBe(200);
      expect(get).toHaveBeenCalledWith(key.replace("abc123def45678", publicId));
      expect(await response.text()).toBe(bundle);
    },
  );

  it("rejects foreign hosts, slugs, malformed paths and query strings before R2", async () => {
    for (const invalid of [
      url.replace("abc123def45678", "abc123def4"),
      url.replace("abc123def45678", "team-abcde"),
      url.replace("abc123def45678", "team-abc123def45678"),
      url.replace("abc123def45678", "editable-slug"),
      url.replace("abc123def45678", "-bc123def4"),
      url.replace("abc123def45678", "abc123def-"),
      url.replace("abc123def45678", "abc_23def4"),
      url.replace("abc123def45678", "-bc123def45678"),
      url.replace("abc123def45678", "abc123def4567-"),
      url.replace("abc123def45678", "abc_23def45678"),
      url.replace("abc123def45678", "01234567890"),
      url.replace("abc123def45678", "012345678901"),
      url.replace("abc123def45678", "0123456789012"),
      url.replace("abc123def45678", "012345678901234"),
      url.replace("tailorkit.app", "tailorkit.app.evil.example"),
      url.replace("abc123def45678", "nested.abc123def45678"),
      `${url}?token=anything`,
      url.replace("client.js", "secret.js"),
      url.replace(appId, "app-slug"),
    ]) {
      await expect(fetchAsset(new Request(invalid))).resolves.toHaveProperty("status", 404);
    }
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  });

  it("supports HEAD and preflight without reading bundle bodies", async () => {
    await expect(fetchAsset(new Request(url, { method: "POST" }))).resolves.toHaveProperty(
      "status",
      405,
    );
    await expect(fetchAsset(new Request(url.replace("https:", "http:")))).resolves.toHaveProperty(
      "status",
      400,
    );
    const preflight = await fetchAsset(new Request(url, { method: "OPTIONS" }));
    expect(preflight.status).toBe(204);
    expect(get).not.toHaveBeenCalled();
    head.mockResolvedValueOnce(object());
    const response = await fetchAsset(new Request(url, { method: "HEAD" }));
    expect(response.status).toBe(200);
    expect(head).toHaveBeenCalledWith(key);
    expect(await response.text()).toBe("");
  });

  it("hides missing or oversized objects and fails safely on R2 errors", async () => {
    get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...object(), size: maxDeploymentBytes + 1 });
    await expect(fetchAsset(new Request(url))).resolves.toHaveProperty("status", 404);
    await expect(fetchAsset(new Request(url))).resolves.toHaveProperty("status", 404);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    get.mockRejectedValueOnce(new Error("private storage detail"));
    await expect(fetchAsset(new Request(url))).resolves.toHaveProperty("status", 503);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private storage detail");
  });
});

it("serves R2 assets when the edge cache lookup fails", async () => {
  match.mockRejectedValueOnce(new Error("Cache unavailable"));
  get.mockResolvedValueOnce(object());
  const response = await fetchAsset(new Request(url));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(bundle);
});

it("keeps the response usable when a background cache write fails", async () => {
  put.mockRejectedValueOnce(new Error("Private cache details"));
  get.mockResolvedValueOnce(object());
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await fetchAsset(new Request(url));
  await waitUntil.mock.calls[0]![0];
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(bundle);
  expect(log).toHaveBeenCalledWith(JSON.stringify({ message: "Asset cache write failed" }));
});

function gzipObject(body = bundle) {
  const bytes = gzipSync(body);
  return {
    ...object(),
    body: new Response(bytes).body,
    size: bytes.byteLength,
    httpMetadata: { contentEncoding: "gzip" },
  };
}

it("serves stored gzip bytes and caches them without double compression", async () => {
  const stored = gzipObject();
  get.mockResolvedValueOnce(stored);
  const response = await fetchAsset(
    new Request(url, { headers: { "Accept-Encoding": "br, gzip" } }),
  );
  expect(response.headers.get("Content-Encoding")).toBe("gzip");
  expect(response.headers.get("Content-Length")).toBe(String(stored.size));
  expect(response.headers.get("Vary")).toBe("Accept-Encoding");
  expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(bundle);
  const cached = put.mock.calls[0]![1];
  expect(cached.headers.get("Content-Encoding")).toBe("gzip");
  expect(gunzipSync(Buffer.from(await cached.arrayBuffer())).toString()).toBe(bundle);
});

it.each(["R2", "cache"])("caps inflated bytes from %s at 3 MiB", async (source) => {
  const stored = gzipObject("a".repeat(maxDeploymentBytes + 1));
  expect(stored.size).toBeLessThan(maxDeploymentBytes);
  if (source === "R2") {
    get.mockResolvedValueOnce(stored);
  } else {
    match.mockResolvedValueOnce(
      new Response(stored.body, {
        headers: assetHeaders({ contentLength: stored.size, contentEncoding: "gzip" }),
      }),
    );
  }
  const response = await fetchAsset(new Request(url));
  const reader = response.body!.getReader();
  let deliveredBytes = 0;
  await expect(
    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        deliveredBytes += value.byteLength;
      }
    })(),
  ).rejects.toThrow("Asset delivery failed (404)");
  expect(deliveredBytes).toBeLessThanOrEqual(maxDeploymentBytes);
});

it("serves a gzip bundle whose decoded size is exactly 3 MiB", async () => {
  get.mockResolvedValueOnce(gzipObject("a".repeat(maxDeploymentBytes)));
  const response = await fetchAsset(new Request(url));
  expect((await response.arrayBuffer()).byteLength).toBe(maxDeploymentBytes);
});

it.each([undefined, "identity", "gzip;q=0, *;q=1"])(
  "decodes a cached gzip bundle for Accept-Encoding %s",
  async (encoding) => {
    const stored = gzipObject();
    match.mockResolvedValueOnce(
      new Response(stored.body, {
        headers: assetHeaders({
          contentLength: stored.size,
          contentEncoding: "gzip",
          etag: stored.httpEtag,
        }),
      }),
    );
    const response = await fetchAsset(
      new Request(url, { headers: encoding ? { "Accept-Encoding": encoding } : undefined }),
    );
    expect(await response.text()).toBe(bundle);
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("ETag")).toBe('W/"etag"');
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
    expect(get).not.toHaveBeenCalled();
  },
);

it.each(["gzip", "identity"])(
  "serves gzip HEAD metadata for %s without reading the body",
  async (encoding) => {
    const stored = gzipObject();
    head.mockResolvedValueOnce(stored);
    const response = await fetchAsset(
      new Request(url, { method: "HEAD", headers: { "Accept-Encoding": encoding } }),
    );
    expect(response.headers.get("Content-Encoding")).toBe(encoding === "gzip" ? "gzip" : null);
    expect(response.headers.get("Content-Length")).toBe(
      encoding === "gzip" ? String(stored.size) : null,
    );
    expect(await response.text()).toBe("");
    expect(get).not.toHaveBeenCalled();
  },
);
