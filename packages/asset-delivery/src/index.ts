import { Effect } from "effect";
import type { LogoContentType } from "./logo-validation";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const publicId = "[0-9a-z]{10}(?:[0-9a-z]{2})?";
const deploymentAssetPath = new RegExp(
  `^/p/(${uuid})/a/(${publicId})/d/(${publicId})/(?:client/(client\\.js)|logos/([a-f0-9]{64}\\.(?:svg|png|webp)))$`,
  "u",
);
const teamIdPattern = /^[a-z0-9][a-z0-9-]{12}[a-z0-9]$/u;
const nodeAssetPath = /^\/api\/assets\/t\/([^/]+)(\/p\/.*)$/u;
const methods = new Set(["GET", "HEAD", "OPTIONS"]);

export const maxDeploymentBytes = 1024 * 1024;
export const maxAssetBytes = maxDeploymentBytes;

export interface AssetIdentity {
  appId: string;
  deploymentId: string;
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

  const match = deploymentAssetPath.exec(pathname);
  if (!match) return;
  const [, projectId, appId, deploymentId, clientFilename, logoFilename] = match;
  const filename = clientFilename ?? logoFilename;
  if (!projectId || !appId || !deploymentId || !filename) return;
  const appKey = `teams/${publicTeamId}/projects/${projectId}/apps/${appId}`;
  return {
    appId,
    deploymentId,
    key: clientFilename
      ? `${appKey}/deployments/${deploymentId}/client/${filename}`
      : `${appKey}/logos/${filename}`,
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

/** Hosted app routes use public team/app IDs and the canonical project UUID. */
const hostedAppPath = new RegExp(`^/p/(${uuid})/a/(${publicId})(/rpc(?:/.*)?)$`, "u");
const publicationPath = new RegExp(`^/p/(${uuid})/a/(${publicId})/new-deployment$`, "u");

export function parseHostedAppRoute(request: Request, assetDomain: string) {
  const url = new URL(request.url);
  const suffix = `.${assetDomain}`;
  const local =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && (url.protocol !== "https:" || url.port || !url.hostname.endsWith(suffix))) return;
  const publicTeamId = local ? undefined : url.hostname.slice(0, -suffix.length);
  if (!local && (!publicTeamId || !teamIdPattern.test(publicTeamId))) return;
  const match = hostedAppPath.exec(url.pathname);
  if (!match) return;
  return { publicTeamId, projectId: match[1]!, appPublicId: match[2]!, rpcPath: match[3]! };
}

/** Publication uses the reserved internal hostname, never a tenant hostname. */
export function parseDeploymentPublicationRoute(request: Request, assetDomain: string) {
  const url = new URL(request.url);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.search ||
    url.hostname !== `internal.${assetDomain}`
  )
    return;
  const match = publicationPath.exec(url.pathname);
  if (!match) return;
  return { projectId: match[1]!, appPublicId: match[2]! };
}

export class AssetDeliveryError extends Error {
  readonly _tag = "AssetDeliveryError";
  constructor(readonly status: 400 | 404 | 405 | 503) {
    super(`Asset delivery failed (${status})`);
  }
}

export function hostedAssetRequest(request: Request, assetDomain: string) {
  return Effect.gen(function* () {
    if (new URL(request.url).protocol !== "https:") {
      return yield* Effect.fail(new AssetDeliveryError(400));
    }
    const identity = parseHostedAssetRequest(request, assetDomain);
    if (!identity) return yield* Effect.fail(new AssetDeliveryError(404));
    return identity;
  });
}

export function nodeAssetRequest(request: Request) {
  return Effect.gen(function* () {
    const identity = parseNodeAssetRequest(request);
    if (!identity) return yield* Effect.fail(new AssetDeliveryError(404));
    return identity;
  });
}

export function assetSize(size: number | undefined) {
  return Effect.gen(function* () {
    if (!isValidAssetSize(size)) return yield* Effect.fail(new AssetDeliveryError(404));
    return size;
  });
}

/** Both delivery adapters share request admission. */
export function serveAssetRequest(
  request: Request,
  options: {
    identity: Effect.Effect<AssetIdentity, AssetDeliveryError>;
    load(identity: AssetIdentity): Effect.Effect<Response, AssetDeliveryError>;
  },
): Effect.Effect<Response, AssetDeliveryError> {
  return Effect.gen(function* () {
    const identity = yield* options.identity;
    if (!isAssetMethod(request.method)) return yield* Effect.fail(new AssetDeliveryError(405));
    if (request.method === "OPTIONS") return assetPreflight();
    return yield* options.load(identity);
  });
}

/** Storage details stay in trusted infrastructure; public failures expose only a status. */
export function assetResponse(
  program: Effect.Effect<Response, AssetDeliveryError>,
  onUnavailable?: () => void,
): Effect.Effect<Response> {
  return program.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        if (error.status === 503) onUnavailable?.();
        return assetFailure(error.status);
      }),
    ),
  );
}
