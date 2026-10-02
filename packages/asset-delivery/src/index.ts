import type { LogoContentType } from "./logo-validation";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const publicId = "[0-9a-z]{10}(?:[0-9a-z]{2})?";
const deploymentAssetPath = new RegExp(
  `^/p/(${uuid})/a/(${publicId})/d/(${publicId})/(client\\.js|logo-(?:light|dark)\\.(?:svg|png|webp))$`,
  "u",
);
const appLogoPath = new RegExp(
  `^/p/(${uuid})/a/(${publicId})/logos/([a-f0-9]{64}\\.(?:svg|png|webp))$`,
  "u",
);
const teamIdPattern = /^[a-z0-9][a-z0-9-]{12}[a-z0-9]$/u;
const nodeAssetPath = /^\/api\/assets\/t\/([^/]+)(\/p\/.*)$/u;
const methods = new Set(["GET", "HEAD", "OPTIONS"]);

export const maxDeploymentBytes = 1024 * 1024;
export const maxAssetBytes = maxDeploymentBytes;

export interface AssetIdentity {
  appId: string;
  deploymentId?: string;
  key: string;
  projectId: string;
  publicTeamId: string;
  contentType: "application/javascript" | LogoContentType;
}

const getAssetContentType = (filename: string): AssetIdentity["contentType"] => {
  if (filename.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (filename.endsWith(".png")) {
    return "image/png";
  }
  if (filename.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/javascript";
};

function createIdentity(publicTeamId: string, pathname: string): AssetIdentity | undefined {
  if (!teamIdPattern.test(publicTeamId)) {
    return;
  }

  const deploymentMatch = deploymentAssetPath.exec(pathname);
  if (deploymentMatch) {
    const [, projectId, appId, deploymentId, filename] = deploymentMatch;
    if (!projectId || !appId || !deploymentId || !filename) {
      return;
    }
    return {
      appId,
      deploymentId,
      key: `teams/${publicTeamId}/projects/${projectId}/apps/${appId}/deployments/${deploymentId}/client/${filename}`,
      projectId,
      publicTeamId,
      contentType: getAssetContentType(filename),
    };
  }

  const logoMatch = appLogoPath.exec(pathname);
  if (!logoMatch) {
    return;
  }
  const [, projectId, appId, filename] = logoMatch;
  if (!projectId || !appId || !filename) {
    return;
  }
  return {
    appId,
    key: `teams/${publicTeamId}/projects/${projectId}/apps/${appId}/logos/${filename}`,
    projectId,
    publicTeamId,
    contentType: getAssetContentType(filename),
  };
}

export function parseHostedAssetRequest(
  request: Request,
  assetDomain: string,
): AssetIdentity | undefined {
  const url = new URL(request.url);
  const suffix = `.${assetDomain}`;
  if (url.protocol !== "https:" || url.port || url.search || !url.hostname.endsWith(suffix)) {
    return;
  }
  return createIdentity(url.hostname.slice(0, -suffix.length), url.pathname);
}

export function parseNodeAssetRequest(request: Request): AssetIdentity | undefined {
  const url = new URL(request.url);
  if (url.search) {
    return;
  }
  const match = nodeAssetPath.exec(url.pathname);
  if (!match) {
    return;
  }
  const [, publicTeamId, assetPathname] = match;
  if (!publicTeamId || !assetPathname) {
    return;
  }
  return createIdentity(publicTeamId, assetPathname);
}

export function isAssetMethod(method: string): boolean {
  return methods.has(method);
}

export function isValidAssetSize(size: number | undefined): size is number {
  return size !== undefined && size >= 1 && size <= maxAssetBytes;
}

export function assetFailure(status: number): Response {
  return new Response(null, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

export function assetPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

export function assetHeaders(input: {
  contentLength: number;
  contentType?: AssetIdentity["contentType"];
  etag?: string;
}): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400",
    "Content-Length": String(input.contentLength),
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type":
      input.contentType === "application/javascript" || input.contentType === undefined
        ? "application/javascript; charset=utf-8"
        : input.contentType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (input.etag) {
    headers.set("ETag", input.etag);
  }
  return headers;
}

/** Read compatibility for already published client assets; never accepts server keys. */
export function legacyClientKey(identity: AssetIdentity): string | undefined {
  return identity.deploymentId ? identity.key.replace("/client/", "/files/") : undefined;
}
