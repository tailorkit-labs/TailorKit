/** Use only explicitly configured URLs, never forwarded request headers. */
export function normalizePublicOrigin(publicUrl: string | URL | undefined): string | undefined {
  if (publicUrl === undefined) return undefined;
  const url = new URL(publicUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("publicUrl must be an absolute HTTP(S) URL without credentials");
  return url.origin;
}
