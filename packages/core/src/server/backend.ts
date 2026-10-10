import type { TailorKitScopes } from "./types";

// Keep the request/build lifecycle and its failure paths together.
// eslint-disable-next-line complexity
export async function handleBackendSession(
  request: Request,
  authenticate: (input: {
    request: Request;
  }) => Promise<{ scopes: TailorKitScopes; subjectId?: string } | null>,
  issueSession: (
    appId: string,
    scopes: TailorKitScopes,
    subjectId?: string,
  ) => Promise<{ token: string; expiresAt: number; url: string } | Response>,
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
  const session = await issueSession(input.appId, viewer.scopes, viewer.subjectId);
  if (session instanceof Response) {
    const responseHeaders = new Headers(session.headers);
    responseHeaders.set("cache-control", "no-store");
    return new Response(session.body, { status: session.status, headers: responseHeaders });
  }
  return Response.json({ ...session, subjectId: viewer.subjectId }, { headers });
}
