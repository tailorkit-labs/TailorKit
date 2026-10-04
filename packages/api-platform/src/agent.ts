import { db } from "@tailorkit/db";
import { agentSession } from "@tailorkit/db/schema/agent-session";
import type { Context } from "./context";
import { getCliTokenScope } from "./routes/cli-auth";

const routePrefix = "/api/platform/agent";
const sessionPath = "/eve/v1/session";
const sessionIdPattern = /^wrun_[A-Za-z0-9_-]{1,128}$/u;

function responseFrom(upstream: Response, body: BodyInit | null = upstream.body): Response {
  const headers = new Headers(upstream.headers);
  for (const name of ["content-encoding", "content-length", "set-cookie", "transfer-encoding"]) {
    headers.delete(name);
  }
  headers.set("cache-control", "no-store");
  return new Response(body, { status: upstream.status, headers });
}

function parseAgentRequest(request: Request) {
  const path = new URL(request.url).pathname.slice(routePrefix.length);
  if (request.method === "POST" && path === sessionPath) {
    return { kind: "create" as const, path };
  }
  const match = /^\/eve\/v1\/session\/([^/]+)(\/stream)?$/u.exec(path);
  if (!match || !sessionIdPattern.test(match[1] ?? "")) return null;
  if (request.method === "POST" && !match[2]) {
    return { kind: "send" as const, path, sessionId: match[1]! };
  }
  if (request.method === "GET" && match[2]) {
    return { kind: "stream" as const, path, sessionId: match[1]! };
  }
  return null;
}

export async function handleAgentRequest(
  request: Request,
  context: Context,
  options: { eveUrl: string; oidcToken?: string },
): Promise<Response> {
  const parsed = parseAgentRequest(request);
  if (!parsed) return new Response("Not found", { status: 404 });

  const cliToken = request.headers.get("x-tailorkit-cli-token");
  if (!cliToken) return new Response("Unauthorized", { status: 401 });

  let scopeKey: string;
  try {
    scopeKey = (await getCliTokenScope(context.project.id, cliToken)).scopeKey;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  if (parsed.kind !== "create") {
    const binding = await db.query.agentSession.findFirst({
      where: { id: parsed.sessionId, projectId: context.project.id, scopeKey },
    });
    if (!binding) return new Response("Not found", { status: 404 });
  }

  const target = new URL(parsed.path, options.eveUrl);
  if (parsed.kind === "stream") target.search = new URL(request.url).search;
  const headers = new Headers();
  if (options.oidcToken) {
    headers.set("authorization", `Bearer ${options.oidcToken}`);
    headers.set("x-vercel-trusted-oidc-idp-token", options.oidcToken);
  }
  if (request.method === "POST") headers.set("content-type", "application/json");

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "POST" ? await request.text() : undefined,
    redirect: "manual",
    signal: request.signal,
  });

  if (parsed.kind !== "create" || !upstream.ok) return responseFrom(upstream);

  const body = await upstream.text();
  let sessionId: unknown;
  try {
    sessionId = (JSON.parse(body) as { sessionId?: unknown }).sessionId;
  } catch {
    return new Response("Invalid Eve session response", { status: 502 });
  }
  if (typeof sessionId !== "string" || !sessionIdPattern.test(sessionId)) {
    return new Response("Invalid Eve session response", { status: 502 });
  }

  await db.insert(agentSession).values({ id: sessionId, projectId: context.project.id, scopeKey });
  return responseFrom(upstream, body);
}
