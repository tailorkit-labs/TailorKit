import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { openapi } from "@orpc/openapi";
import { eventIterator, os } from "@orpc/server";
import { agentEventSchema, type AgentEvent } from "@tailorkit/client-platform/agent";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { createTailorKitClient } from "./client";
import { createTailorKitServer } from "./handler";

const sessionId = "a3e7568a-c4f7-4ac0-8c35-71ff0f4cd002";
const events: AgentEvent[] = [
  { type: "step" },
  { type: "text", delta: "Building 🛠 " },
  { type: "tool", name: "write", callId: "tool-1" },
  { type: "text", delta: "your app." },
  { type: "done" },
];

function setup(
  options: { events?: AgentEvent[]; status?: number; scopeName?: string; closed?: boolean } = {},
) {
  const requests: Request[] = [];
  const platform = new OpenAPIHandler({
    chat: os
      .meta(openapi({ path: "/agent/{sessionId}/chat", method: "POST" }))
      .output(eventIterator(agentEventSchema))
      .handler(async function* () {
        yield* options.events ?? events;
      }),
  });
  const server = createTailorKitServer({
    projectKey: "host-project-key",
    scopes: { org: z.object({ tenant: z.string() }) },
    components: {},
    $internal: {
      platformBaseUrl: "https://platform.test/api/platform",
      platformFetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push(request.clone());
        if (request.url.endsWith("/cli-auth/verify-token")) {
          return Response.json({
            scope: { name: options.scopeName ?? "org", value: { tenant: "verified" } },
          });
        }
        if (request.url.endsWith("/agent/start"))
          return Response.json({ sessionId, expiresAt: "2026-10-06T01:00:00Z" });
        if (request.url.endsWith("/close"))
          return options.closed
            ? Response.json(
                { defined: false, code: "NOT_FOUND", message: "Agent session is unavailable." },
                { status: 404 },
              )
            : Response.json({});
        if (options.status) return new Response("Unavailable", { status: options.status });
        const result = await platform.handle(request, { prefix: "/api/platform" });
        return result.response ?? new Response("Missing route", { status: 404 });
      },
    },
  });
  const client = createTailorKitClient({
    url: "https://host.test/api/tailorkit",
    headers: { authorization: "Bearer cli-token" },
    fetch: async (input, init) =>
      server.handler(new Request(input, init), { authenticate: () => null }),
  });
  return { client, requests, server };
}

describe("host agent relay", () => {
  it("verifies CLI auth, uses the host project key, and round trips streamed events", async () => {
    const { client, requests } = setup();
    await expect(client.agent.start({})).resolves.toMatchObject({ sessionId });
    const received = [];
    for await (const event of await client.agent.chat({ sessionId, message: "Build an app" }))
      received.push(event);
    expect(received).toEqual(events);
    await client.agent.close({ sessionId });
    for (const request of requests)
      expect(request.headers.get("authorization")).toBe("Bearer host-project-key");
    const chat = requests.find((request) => request.url.endsWith("/chat"))!;
    expect(await chat.json()).toEqual({ deployToken: "cli-token", message: "Build an app" });
    expect(requests.filter((request) => request.url.endsWith("/verify-token"))).toHaveLength(3);
  });

  it("requires a CLI credential before contacting the platform", async () => {
    const { server, requests } = setup();
    const client = createTailorKitClient({
      url: "https://host.test/api/tailorkit",
      fetch: async (input, init) =>
        server.handler(new Request(input, init), { authenticate: () => null }),
    });
    await expect(client.agent.start({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(requests).toHaveLength(0);
  });

  it("preserves a closed session error for CLI disconnect cleanup", async () => {
    const { client } = setup({ closed: true });
    await expect(client.agent.close({ sessionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a token for an undeclared host scope", async () => {
    const { client } = setup({ scopeName: "forged" });
    await expect(client.agent.start({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("fails an interrupted stream without replaying the chat POST", async () => {
    const { client, requests } = setup({ events: events.slice(0, 2) });
    await expect(
      (async () => {
        for await (const _event of await client.agent.chat({ sessionId, message: "Build" })) {
          /* consume */
        }
      })(),
    ).rejects.toThrow("ended unexpectedly");
    expect(requests.filter((request) => request.url.endsWith("/chat"))).toHaveLength(1);
  });

  it("surfaces an upstream HTTP failure without retrying", async () => {
    const { client, requests } = setup({ status: 401 });
    await expect(
      (async () => {
        for await (const _event of await client.agent.chat({ sessionId, message: "Build" })) {
          /* consume */
        }
      })(),
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    expect(requests.filter((request) => request.url.endsWith("/chat"))).toHaveLength(1);
  });
});
