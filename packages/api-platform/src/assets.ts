import {
  assetFailure,
  assetHeaders,
  assetPreflight,
  isAssetMethod,
  isValidAssetSize,
  parseNodeAssetRequest,
} from "@tailorkit/asset-delivery";
import type { Storage } from "@tailorkit/storage";

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    value.name === "NoSuchKey" ||
    value.name === "NotFound" ||
    value.$metadata?.httpStatusCode === 404
  );
}

export async function handleAssetRequest(
  request: Request,
  storage: Storage | null,
): Promise<Response> {
  const identity = parseNodeAssetRequest(request);
  if (!identity) {
    return assetFailure(404);
  }
  if (!storage) {
    return assetFailure(503);
  }
  if (!isAssetMethod(request.method)) {
    return assetFailure(405);
  }
  if (request.method === "OPTIONS") {
    return assetPreflight();
  }

  try {
    const key = identity.key;
    const object = await storage.head({ key });
    if (!isValidAssetSize(object.contentLength)) {
      return assetFailure(404);
    }
    const headers = assetHeaders({
      contentLength: object.contentLength,
      contentType: identity.contentType,
      etag: object.etag,
    });
    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }
    const download = await storage.createDownloadUrl({
      key,
      expiresInSeconds: 60,
    });
    const upstream = await fetch(download.url, { redirect: "error" });
    if (!upstream.ok) {
      return assetFailure(upstream.status === 404 ? 404 : 503);
    }
    return new Response(upstream.body, { headers });
  } catch (error) {
    return assetFailure(isNotFound(error) ? 404 : 503);
  }
}
