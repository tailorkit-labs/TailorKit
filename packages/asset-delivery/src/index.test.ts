import { describe, expect, it } from "vite-plus/test";
import {
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
const assetPath = `/p/${projectId}/a/${appId}/d/${deploymentId}/client.js`;
const logoHash = "b".repeat(64);
const localUrl = `http://localhost:3000/api/assets/t/${teamId}${assetPath}`;
const hostedUrl = `https://${teamId}.tailorkit.app${assetPath}`;

describe("asset delivery contract", () => {
  it("maps the same local and hosted URL contract to one storage key", () => {
    const expected = {
      appId,
      deploymentId,
      key: `teams/${teamId}/projects/${projectId}/apps/${appId}/deployments/${deploymentId}/files/client.js`,
      projectId,
      publicTeamId: teamId,
      contentType: "application/javascript",
    };
    expect(parseNodeAssetRequest(new Request(localUrl))).toEqual(expected);
    expect(parseHostedAssetRequest(new Request(hostedUrl), "tailorkit.app")).toEqual(expected);
  });

  it("maps logo variants to their storage keys and content types", () => {
    expect(
      parseNodeAssetRequest(new Request(localUrl.replace("client.js", "logo-dark.svg"))),
    ).toEqual(
      expect.objectContaining({
        contentType: "image/svg+xml",
        key: expect.stringMatching(/\/files\/logo-dark\.svg$/u),
      }),
    );
  });

  it("maps content-addressed app logos to shared storage keys", () => {
    const logoPath = `/p/${projectId}/a/${appId}/logos/${logoHash}.webp`;
    expect(
      parseNodeAssetRequest(new Request(`http://localhost:3000/api/assets/t/${teamId}${logoPath}`)),
    ).toEqual({
      appId,
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
    expect(isValidAssetSize(1024 * 1024)).toBe(true);
    expect(isValidAssetSize(0)).toBe(false);
    expect(isValidAssetSize(1024 * 1024 + 1)).toBe(false);
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
