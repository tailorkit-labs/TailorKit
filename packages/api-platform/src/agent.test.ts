import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Context } from "./context";

const state = vi.hoisted(() => ({
  bindings: [] as { id: string; projectId: string; scopeKey: string }[],
  scopeKey: "scope-a",
}));

vi.mock("@tailorkit/db", () => ({
  db: {
    query: {
      agentSession: {
        findFirst: async ({ where }: { where: (typeof state.bindings)[number] }) =>
          state.bindings.find(
            (binding) =>
              binding.id === where.id &&
              binding.projectId === where.projectId &&
              binding.scopeKey === where.scopeKey,
          ),
      },
    },
    insert: () => ({
      values: async (binding: (typeof state.bindings)[number]) => {
        state.bindings.push(binding);
      },
    }),
  },
}));
vi.mock("./routes/cli-auth", () => ({
  getCliTokenScope: async () => ({ scopeKey: state.scopeKey }),
}));

const { handleAgentRequest } = await import("./agent");
const sessionId = "wrun_test-session";
const context = (projectId: string) => ({ project: { id: projectId } }) as Context;
const options = { eveUrl: "https://eve.test", oidcToken: "vercel-oidc" };

function agentRequest(path: string, method: "GET" | "POST" = "GET") {
  return new Request(`https://platform.test/api/platform/agent${path}`, {
    method,
    headers: { "x-tailorkit-cli-token": "cli-token" },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
}

describe("platform agent relay", () => {
  const upstream = vi.fn(async (input: URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.method === "POST" && new URL(request.url).pathname === "/eve/v1/session") {
      return Response.json({ sessionId });
    }
    return new Response("event: message\ndata: hello\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  });

  beforeEach(() => {
    state.bindings.length = 0;
    state.scopeKey = "scope-a";
    upstream.mockClear();
    vi.stubGlobal("fetch", upstream);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("binds a new Eve session to the authenticated project and CLI scope", async () => {
    const response = await handleAgentRequest(
      agentRequest("/eve/v1/session", "POST"),
      context("project-a"),
      options,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId });
    expect(state.bindings).toMatchObject([
      { id: sessionId, projectId: "project-a", scopeKey: "scope-a" },
    ]);
    expect(upstream).toHaveBeenCalledTimes(1);
    const sent = upstream.mock.calls[0];
    expect(String(sent?.[0])).toBe("https://eve.test/eve/v1/session");
    expect(new Headers(sent?.[1]?.headers).get("authorization")).toBe("Bearer vercel-oidc");
  });

  it("allows follow-up messages and streams only for the same project and scope", async () => {
    state.bindings.push({ id: sessionId, projectId: "project-a", scopeKey: "scope-a" });
    const sent = await handleAgentRequest(
      agentRequest(`/eve/v1/session/${sessionId}`, "POST"),
      context("project-a"),
      options,
    );
    expect(sent.status).toBe(200);

    const streamed = await handleAgentRequest(
      agentRequest(`/eve/v1/session/${sessionId}/stream?cursor=2`),
      context("project-a"),
      options,
    );
    expect(streamed.headers.get("content-type")).toBe("text/event-stream");
    expect(await streamed.text()).toContain("data: hello");
    expect(String(upstream.mock.calls[1]?.[0])).toBe(
      `https://eve.test/eve/v1/session/${sessionId}/stream?cursor=2`,
    );

    state.scopeKey = "scope-b";
    const otherScope = await handleAgentRequest(
      agentRequest(`/eve/v1/session/${sessionId}`, "POST"),
      context("project-a"),
      options,
    );
    expect(otherScope.status).toBe(404);
    state.scopeKey = "scope-a";
    const otherProject = await handleAgentRequest(
      agentRequest(`/eve/v1/session/${sessionId}/stream`),
      context("project-b"),
      options,
    );
    expect(otherProject.status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("rejects unbound sessions and unrelated Eve routes", async () => {
    const unbound = await handleAgentRequest(
      agentRequest(`/eve/v1/session/${sessionId}/stream`),
      context("project-a"),
      options,
    );
    expect(unbound.status).toBe(404);
    const unrelated = await handleAgentRequest(
      agentRequest("/eve/v1/health"),
      context("project-a"),
      options,
    );
    expect(unrelated.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
