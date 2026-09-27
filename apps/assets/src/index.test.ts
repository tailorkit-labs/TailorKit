import { assetHeaders } from "@tailorkit/asset-delivery";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import worker from "./index";

const projectId = "22222222-2222-4222-8222-222222222222";
const appId = "app000000001";
const deploymentId = "deploy000001";
const path = `/p/${projectId}/a/${appId}/d/${deploymentId}/client.js`;
const url = `https://abc123def45678.tailorkit.app${path}`;
const key = `teams/abc123def45678/projects/${projectId}/apps/${appId}/deployments/${deploymentId}/files/client.js`;
const bundle = "export default 'tenant bundle';";
const get = vi.fn();
const head = vi.fn();
const match = vi.fn((_request: Request) => Promise.resolve(undefined as Response | undefined));
const put = vi.fn((_request: Request, _response: Response) => Promise.resolve());
const waitUntil = vi.fn();
const env = { ASSET_DOMAIN: "tailorkit.app", ASSETS: { get, head } } as unknown as Env;
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
    const response = await fetchAsset(new Request(url.replace("client.js", "logo-light.svg")));
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(get).toHaveBeenCalledWith(key.replace("client.js", "logo-light.svg"));
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
    get.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...object(), size: 1024 * 1024 + 1 });
    await expect(fetchAsset(new Request(url))).resolves.toHaveProperty("status", 404);
    await expect(fetchAsset(new Request(url))).resolves.toHaveProperty("status", 404);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    get.mockRejectedValueOnce(new Error("private storage detail"));
    await expect(fetchAsset(new Request(url))).resolves.toHaveProperty("status", 503);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private storage detail");
  });
});
