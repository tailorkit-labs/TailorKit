import type { TailorKitPlatformOptions } from "./types";

const sessionIdPattern = /^wrun_[A-Za-z0-9_-]{1,128}$/u;

function isAgentProtocolRequest(path: string, method: string): boolean {
  if (method === "POST" && path === "/eve/v1/session") return true;
  const match = /^\/eve\/v1\/session\/([^/]+)(\/stream)?$/u.exec(path);
  if (!match || !sessionIdPattern.test(match[1] ?? "")) return false;
  return (method === "POST" && !match[2]) || (method === "GET" && Boolean(match[2]));
}

export async function handleAgentRelay(
  request: Request,
  options: {
    basePath: string;
    platformBaseUrl: string;
    platformFetch?: typeof fetch;
    platformHeaders?: TailorKitPlatformOptions["headers"];
  },
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(`${options.basePath}/agent`.length);
  if (!isAgentProtocolRequest(path, request.method)) {
    return new Response("Not found", { status: 404 });
  }

  const [scheme, cliToken] = request.headers.get("authorization")?.split(" ") ?? [];
  if (scheme !== "Bearer" || !cliToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const configuredHeaders = await (typeof options.platformHeaders === "function"
    ? options.platformHeaders()
    : options.platformHeaders);
  const headers = new Headers(configuredHeaders);
  headers.set("x-tailorkit-cli-token", cliToken);
  if (request.method === "POST") headers.set("content-type", "application/json");

  const target = new URL(options.platformBaseUrl);
  target.pathname = `${target.pathname.replace(/\/+$/u, "")}/agent${path}`;
  if (request.method === "GET") target.search = url.search;

  const upstream = await (options.platformFetch ?? fetch)(target, {
    method: request.method,
    headers,
    body: request.method === "POST" ? await request.text() : undefined,
    redirect: "manual",
    signal: request.signal,
  });
  const responseHeaders = new Headers(upstream.headers);
  for (const name of ["content-encoding", "content-length", "set-cookie", "transfer-encoding"]) {
    responseHeaders.delete(name);
  }
  responseHeaders.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
