import {
  AssetDeliveryError,
  assetHeaders,
  assetResponse,
  assetSize,
  nodeAssetRequest,
  serveAssetRequest,
} from "@tailorkit/asset-delivery";
import type { AssetIdentity } from "@tailorkit/asset-delivery";
import type { Storage } from "@tailorkit/storage";
import { Effect } from "effect";

function storageFailure(error: unknown) {
  if (error && typeof error === "object") {
    const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      value.name === "NoSuchKey" ||
      value.name === "NotFound" ||
      value.$metadata?.httpStatusCode === 404
    ) {
      return new AssetDeliveryError(404);
    }
  }
  return new AssetDeliveryError(503);
}

function loadAsset(request: Request, identity: AssetIdentity, storage: Storage) {
  return Effect.gen(function* () {
    const key = identity.key;
    const object = yield* Effect.tryPromise({
      try: () => storage.head({ key }),
      catch: storageFailure,
    });
    const contentLength = yield* assetSize(object.contentLength);
    const headers = assetHeaders({
      contentLength,
      contentType: identity.contentType,
      etag: object.etag,
    });
    if (request.method === "HEAD") return new Response(null, { headers });
    const download = yield* Effect.tryPromise({
      try: () => storage.createDownloadUrl({ key, expiresInSeconds: 60 }),
      catch: storageFailure,
    });
    const upstream = yield* Effect.tryPromise({
      try: (signal) => fetch(download.url, { redirect: "error", signal }),
      catch: storageFailure,
    });
    if (!upstream.ok)
      return yield* Effect.fail(new AssetDeliveryError(upstream.status === 404 ? 404 : 503));
    return new Response(upstream.body, { headers });
  });
}

export function handleAssetRequest(request: Request, storage: Storage | null): Promise<Response> {
  const program = Effect.gen(function* () {
    const identity = yield* nodeAssetRequest(request);
    if (!storage) return yield* Effect.fail(new AssetDeliveryError(503));
    return yield* serveAssetRequest(request, {
      identity: Effect.succeed(identity),
      load: (asset) => loadAsset(request, asset, storage),
    });
  });
  return Effect.runPromise(assetResponse(program));
}
