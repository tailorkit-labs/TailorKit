/** Resolve the required public URL into a route prefix and trusted origin. */
export function normalizeBaseUrl(baseUrl: string | URL) {
  const value = String(baseUrl);
  if (!/^https?:\/\/[^/]/iu.test(value) || /[\\\s]/u.test(value)) {
    throw new Error("baseUrl must be an absolute HTTP(S) URL");
  }
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("baseUrl must be HTTP(S) without credentials, query parameters or a fragment");
  }
  return {
    basePath: url.pathname.replace(/\/+$/u, ""),
    publicOrigin: url.origin,
  };
}
