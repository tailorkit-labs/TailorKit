/** Resolve the configured route prefix and trusted origin without using forwarded headers. */
export function normalizeBaseUrl(baseUrl: string | URL = "/api/tailorkit") {
  const value = String(baseUrl);
  const relative = value.startsWith("/");
  if (value.startsWith("//") || /[\\\s]/u.test(value))
    throw new Error("baseUrl must be an absolute HTTP(S) URL or a root-relative path");
  const url = new URL(value, relative ? "https://tailorkit.invalid" : undefined);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("baseUrl must be HTTP(S) without credentials, query parameters or a fragment");
  return {
    basePath: url.pathname.replace(/\/+$/u, ""),
    publicOrigin: relative ? undefined : url.origin,
  };
}
