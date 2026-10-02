import {
  AssetDeliveryError,
  assetHeaders,
  assetResponse,
  assetSize,
  hostedAssetRequest,
  serveAssetRequest,
} from "@tailorkit/asset-delivery";
import type { AssetIdentity } from "@tailorkit/asset-delivery";
import { Effect } from "effect";

function downstreamResponse(response: Response, method: string) {
  const headers = new Headers(response.headers);
  // Keep browser reuse bounded when a deployment is removed.
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(method === "HEAD" ? null : response.body, {
    headers,
    status: response.status,
  });
}

function loadAsset(request: Request, identity: AssetIdentity, env: Env, ctx: ExecutionContext) {
  return Effect.gen(function* () {
    // Node/DOM ambient types omit Cloudflare's default edge cache.
    const edgeCache = caches as CacheStorage & { readonly default: Cache };
    const cacheKey = new Request(request.url);
    const cached = yield* Effect.tryPromise(() => edgeCache.default.match(cacheKey)).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    );
    if (cached) return downstreamResponse(cached, request.method);

    if (request.method === "HEAD") {
      const object = yield* Effect.tryPromise({
        try: () => env.BUNDLES.head(identity.key),
        catch: () => new AssetDeliveryError(503),
      });
      const contentLength = yield* assetSize(object?.size);
      return downstreamResponse(
        new Response(null, {
          headers: assetHeaders({
            contentLength,
            contentType: identity.contentType,
            etag: object?.httpEtag,
          }),
        }),
        request.method,
      );
    }

    const object = yield* Effect.tryPromise({
      try: () => env.BUNDLES.get(identity.key),
      catch: () => new AssetDeliveryError(503),
    });
    const contentLength = yield* assetSize(object?.size);
    if (!object) return yield* Effect.fail(new AssetDeliveryError(404));
    const response = new Response(object.body, {
      headers: assetHeaders({
        contentLength,
        contentType: identity.contentType,
        etag: object.httpEtag,
      }),
    });
    const cacheWrite = Effect.tryPromise(() =>
      edgeCache.default.put(cacheKey, response.clone()),
    ).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          console.error(JSON.stringify({ message: "Asset cache write failed" }));
        }),
      ),
    );
    yield* Effect.sync(() => ctx.waitUntil(Effect.runPromise(cacheWrite)));
    return downstreamResponse(response, request.method);
  });
}

export default {
  fetch(request, env, ctx) {
    const program = serveAssetRequest(request, {
      identity: hostedAssetRequest(request, env.ASSET_DOMAIN),
      load: (identity) => loadAsset(request, identity, env, ctx),
    });
    return Effect.runPromise(
      assetResponse(program, () => {
        console.error(
          JSON.stringify({
            message: "Asset delivery failed",
            hostname: new URL(request.url).hostname,
          }),
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;
