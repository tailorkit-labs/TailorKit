import { describe, expect, it } from "vite-plus/test";
import {
  acceptsGzip,
  assetFailure,
  assetHeaders,
  assetPreflight,
  isAssetMethod,
  isValidAssetSize,
  parseHostedAssetRequest,
  parseNodeAssetRequest,
} from "./index";

const teamId = "abc123def45678";
const projectId = "22222222-2222-4222-8222-222222222222";
const appId = "app000000001";
const deploymentId = "deploy000001";
const assetPath = `/p/${projectId}/a/${appId}/d/${deploymentId}/client/client.js`;
const logoHash = "b".repeat(64);
const localUrl = `http://localhost:3000/api/assets/t/${teamId}${assetPath}`;
const hostedUrl = `https://${teamId}.tailorkit.app${assetPath}`;

describe("gzip content negotiation", () => {
  it.each([
    ["gzip ;q=0, *;q=1", false],
    ["gzip\t; q=0, * ; q=1", false],
    ["*;q=1, gzip ; q=0", false],
    ["GZIP ; q=0.5, *;q=0", true],
    ["br, * ; q=1", true],
    ["gzip ; q=0", false],
    ["br", false],
  ])("negotiates %s as %s", (acceptEncoding, expected) => {
    expect(
      acceptsGzip(new Request(hostedUrl, { headers: { "Accept-Encoding": acceptEncoding } })),
    ).toBe(expected);
  });
});

describe("asset delivery contract", () => {
  it("maps the same local and hosted URL contract to one storage key", () => {
    const expected = {
      appId,
      deploymentId,
      key: `teams/${teamId}/projects/${projectId}/apps/${appId}/deployments/${deploymentId}/client/client.js`,
      projectId,
      publicTeamId: teamId,
      contentType: "application/javascript",
    };
    expect(parseNodeAssetRequest(new Request(localUrl))).toEqual(expected);
    expect(parseHostedAssetRequest(new Request(hostedUrl), "tailorkit.app")).toEqual(expected);
  });

  it("maps content-addressed app logos to shared storage keys", () => {
    const logoPath = `/p/${projectId}/a/${appId}/d/${deploymentId}/logos/${logoHash}.webp`;
    expect(
      parseNodeAssetRequest(new Request(`http://localhost:3000/api/assets/t/${teamId}${logoPath}`)),
    ).toEqual({
      appId,
      deploymentId,
      contentType: "image/webp",
      key: `teams/${teamId}/projects/${projectId}/apps/${appId}/logos/${logoHash}.webp`,
      projectId,
      publicTeamId: teamId,
    });
    expect(
      parseHostedAssetRequest(
        new Request(`https://${teamId}.tailorkit.app${logoPath}`),
        "tailorkit.app",
      ),
    ).toEqual(
      expect.objectContaining({
        key: `teams/${teamId}/projects/${projectId}/apps/${appId}/logos/${logoHash}.webp`,
      }),
    );
  });

  it("requires the hosted tenant hostname to match the request identity", () => {
    expect(
      parseHostedAssetRequest(
        new Request(hostedUrl.replace("tailorkit.app", "tailorkit.app.evil.example")),
        "tailorkit.app",
      ),
    ).toBeUndefined();
    expect(
      parseHostedAssetRequest(new Request(hostedUrl.replace("https:", "http:")), "tailorkit.app"),
    ).toBeUndefined();
  });

  it("rejects malformed and ambiguous requests", () => {
    for (const invalid of [
      localUrl.replace("/api/assets", "/other"),
      `${localUrl}?extra=value`,
      localUrl.replace(teamId, "short"),
      localUrl.replace(appId, "app-slug"),
    ]) {
      expect(parseNodeAssetRequest(new Request(invalid))).toBeUndefined();
    }
  });

  it("provides identical method, size, error, preflight and asset response rules", () => {
    expect(["GET", "HEAD", "OPTIONS"].every(isAssetMethod)).toBe(true);
    expect(isAssetMethod("POST")).toBe(false);
    expect(isValidAssetSize(1)).toBe(true);
    expect(isValidAssetSize(3 * 1024 * 1024)).toBe(true);
    expect(isValidAssetSize(0)).toBe(false);
    expect(isValidAssetSize(3 * 1024 * 1024 + 1)).toBe(false);
    expect(assetFailure(404).headers.get("Cache-Control")).toBe("no-store");
    expect(assetPreflight().status).toBe(204);
    const headers = assetHeaders({ contentLength: 10, etag: '"etag"' });
    expect(headers.get("Content-Length")).toBe("10");
    expect(headers.get("ETag")).toBe('"etag"');
    expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(assetHeaders({ contentLength: 10, contentType: "image/png" }).get("Content-Type")).toBe(
      "image/png",
    );
  });
});

it("rejects retired flat asset and app-scoped logo URLs", () => {
  for (const path of [
    assetPath.replace("/client/client.js", "/client.js"),
    assetPath.replace("/client/client.js", "/logo-light.svg"),
    assetPath.replace("/client/client.js", "/logos/logo-light.svg"),
    `/p/${projectId}/a/${appId}/logos/${logoHash}.svg`,
  ]) {
    expect(
      parseHostedAssetRequest(
        new Request(`https://${teamId}.tailorkit.app${path}`),
        "tailorkit.app",
      ),
    ).toBeUndefined();
    expect(
      parseNodeAssetRequest(new Request(`http://localhost:3000/api/assets/t/${teamId}${path}`)),
    ).toBeUndefined();
  }
});
