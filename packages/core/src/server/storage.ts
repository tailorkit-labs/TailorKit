import { issueStorageToken } from "@tailorkit/app-storage/auth";
import type { StorageSigningOptions } from "@tailorkit/app-storage/auth";
import type { TailorKitScopes } from "./types";

export interface HostStorageOptions extends StorageSigningOptions {
  /** Authorize membership and resolve a stable installation from the host's verified scopes.
   * Return null for unauthorized apps. The client cannot choose a storage ID or runtime URL.
   */
  resolveInstallation(context: {
    request: Request;
    appId: string;
    scopes: TailorKitScopes;
  }):
    | { userId: string; appId: string; installationId: string; url: string }
    | null
    | Promise<{ userId: string; appId: string; installationId: string; url: string } | null>;
}
// Keep the request/build lifecycle and its failure paths together.
// eslint-disable-next-line complexity
export async function handleStorageSession(
  request: Request,
  options: HostStorageOptions,
  authenticate: (input: { request: Request }) => Promise<{ scopes: TailorKitScopes } | null>,
) {
  const headers = { "cache-control": "no-store" };
  const origin = request.headers.get("origin");
  if (
    request.method !== "POST" ||
    !request.headers.get("content-type")?.startsWith("application/json") ||
    (origin && origin !== new URL(request.url).origin)
  ) {
    return new Response("Invalid request", { status: 400, headers });
  }
  const viewer = await authenticate({ request });
  if (!viewer) {
    return new Response("Unauthorized", { status: 401, headers });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 4096) {
    return new Response("Too large", { status: 413, headers });
  }
  // Bound chunked bodies too; a sandbox cannot allocate an unbounded host request.
  const reader = request.body?.getReader();
  let body = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        return new Response("Too large", { status: 413, headers });
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers });
  }
  if (
    !input ||
    typeof input !== "object" ||
    !("appId" in input) ||
    typeof input.appId !== "string" ||
    !input.appId ||
    input.appId.length > 256 ||
    Object.keys(input).length !== 1
  ) {
    return new Response("Invalid app", { status: 400, headers });
  }
  const access = await options.resolveInstallation({
    request,
    appId: input.appId,
    scopes: viewer.scopes,
  });
  if (!access || access.appId !== input.appId) {
    return new Response("Forbidden", { status: 403, headers });
  }
  const url = new URL(access.url);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new Error("Storage runtime URLs require HTTPS (or loopback for local development)");
  }
  const session = await issueStorageToken(options, access);
  return Response.json({ ...session, url: access.url }, { headers });
}
