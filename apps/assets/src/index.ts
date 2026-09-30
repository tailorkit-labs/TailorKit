import {
  assetFailure,
  assetHeaders,
  assetPreflight,
  isAssetMethod,
  legacyClientKey,
  isValidAssetSize,
  parseHostedAssetRequest,
} from "@tailorkit/asset-delivery";

function downstreamResponse(response: Response, method: string) {
  const headers = new Headers(response.headers);
  // Deployment URLs are immutable, but keep the browser TTL bounded so removed
  // deployments stop being reused locally within a predictable window.
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(method === "HEAD" ? null : response.body, {
    headers,
    status: response.status,
  });
}

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).protocol !== "https:") {
      return assetFailure(400);
    }
    const identity = parseHostedAssetRequest(request, env.ASSET_DOMAIN);
    if (!identity) {
      return assetFailure(404);
    }
    if (!isAssetMethod(request.method)) {
      return assetFailure(405);
    }
    if (request.method === "OPTIONS") {
      return assetPreflight();
    }

    try {
      const cacheKey = new Request(request.url);
      const cached = await caches.default.match(cacheKey).catch(() => null);
      if (cached) {
        return downstreamResponse(cached, request.method);
      }
      const legacyKey = legacyClientKey(identity);
      if (request.method === "HEAD") {
        const object =
          (await env.ASSETS.head(identity.key)) ??
          (legacyKey ? await env.ASSETS.head(legacyKey) : null);
        if (!object || !isValidAssetSize(object.size)) {
          return assetFailure(404);
        }
        return downstreamResponse(
          new Response(null, {
            headers: assetHeaders({
              contentLength: object.size,
              contentType: identity.contentType,
              etag: object.httpEtag,
            }),
          }),
          request.method,
        );
      }
      const object =
        (await env.ASSETS.get(identity.key)) ??
        (legacyKey ? await env.ASSETS.get(legacyKey) : null);
      if (!object || !isValidAssetSize(object.size)) {
        return assetFailure(404);
      }
      const response = new Response(object.body, {
        headers: assetHeaders({
          contentLength: object.size,
          contentType: identity.contentType,
          etag: object.httpEtag,
        }),
      });
      ctx.waitUntil(
        caches.default.put(cacheKey, response.clone()).catch(() => {
          console.error(JSON.stringify({ message: "Asset cache write failed" }));
        }),
      );
      return downstreamResponse(response, request.method);
    } catch {
      console.error(
        JSON.stringify({
          message: "Asset delivery failed",
          hostname: new URL(request.url).hostname,
        }),
      );
      return assetFailure(503);
    }
  },
} satisfies ExportedHandler<Env>;
