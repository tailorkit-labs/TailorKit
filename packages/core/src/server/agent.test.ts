import { asyncIteratorToUnproxiedDataStream } from "@orpc/client";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { openapi } from "@orpc/openapi";
import { eventIterator, os } from "@orpc/server";
import { agentChunkSchema, type AgentChunk } from "@tailorkit/client-platform/agent";
import { readUIMessageStream } from "ai";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { createTailorKitClient } from "./client";
import { createTailorKitServer } from "./handler";

const messages = [
  { id: "user-1", role: "user" as const, parts: [{ type: "text" as const, text: "Build an app" }] },
];
const hostUrl = "http://localhost:3000/api/tailorkit";
const appId = "a3e7568a-c4f7-4ac0-8c35-71ff0f4cd002";
const events: AgentChunk[] = [
  { type: "start", messageId: "answer" },
  { type: "start-step" },
  { type: "text-start", id: "text-1" },
  { type: "text-delta", id: "text-1", delta: "Building 🛠 " },
  {
    type: "tool-input-available",
    toolName: "write",
    toolCallId: "tool-1",
    input: { path: "app.ts" },
  },
  { type: "tool-output-available", toolCallId: "tool-1", output: { success: true } },
  { type: "text-delta", id: "text-1", delta: "your app." },
  { type: "text-end", id: "text-1" },
  { type: "finish-step" },
  { type: "finish" },
];

function setup(options: { events?: AgentChunk[]; status?: number; scopeName?: string } = {}) {
  const requests: Request[] = [];
  const platform = new OpenAPIHandler({
    chat: os
      .meta(openapi({ path: "/app-agent/chat", method: "POST" }))
      .output(eventIterator(agentChunkSchema))
      .handler(async function* () {
        yield* options.events ?? events;
      }),
  });
  const server = createTailorKitServer({
    baseUrl: "https://example.com/api/tailorkit",
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
    const received = [];
    for await (const event of await client.appAgent.chat({ appId, hostUrl, messages }))
      received.push(event);
    expect(received).toEqual(events);
    for (const request of requests)
      expect(request.headers.get("authorization")).toBe("Bearer host-project-key");
    const chat = requests.find((request) => request.url.endsWith("/chat"))!;
    expect(await chat.json()).toEqual({ deployToken: "cli-token", appId, hostUrl, messages });
    expect(requests.filter((request) => request.url.endsWith("/verify-token"))).toHaveLength(1);
  });

  it("forwards a supplied local schema without fetching from the host", async () => {
    const { client, requests } = setup();
    const schema = { version: 1, components: {}, views: {}, slots: {}, tools: {} };
    for await (const _ of await client.appAgent.chat({ appId, hostUrl, schema, messages })) {
      /* consume */
    }
    const chat = requests.find((request) => request.url.endsWith("/chat"))!;
    expect(await chat.json()).toEqual({
      deployToken: "cli-token",
      appId,
      hostUrl,
      schema,
      messages,
    });
    expect(requests.some((request) => request.url.endsWith("/schema"))).toBe(false);
  });

  it("assembles AI SDK messages across the real oRPC and OpenAPI transports", async () => {
    const { client } = setup();
    const chunks = await client.appAgent.chat({ appId, hostUrl, messages });
    let latest;
    for await (const message of readUIMessageStream({
      stream: asyncIteratorToUnproxiedDataStream(chunks),
      terminateOnError: true,
    }))
      latest = message;
    expect(latest?.parts).toContainEqual(
      expect.objectContaining({ type: "text", text: "Building 🛠 your app." }),
    );
    expect(latest?.parts).toContainEqual(
      expect.objectContaining({
        type: "tool-write",
        toolCallId: "tool-1",
        state: "output-available",
      }),
    );
  });

  it("requires a CLI credential before contacting the platform", async () => {
    const { server, requests } = setup();
    const client = createTailorKitClient({
      url: "https://host.test/api/tailorkit",
      fetch: async (input, init) =>
        server.handler(new Request(input, init), { authenticate: () => null }),
    });
    await expect(client.appAgent.chat({ appId, hostUrl, messages })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(requests).toHaveLength(0);
  });

  it("rejects a token for an undeclared host scope", async () => {
    const { client } = setup({ scopeName: "forged" });
    await expect(client.appAgent.chat({ appId, hostUrl, messages })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("fails an interrupted stream without replaying the chat POST", async () => {
    const { client, requests } = setup({ events: events.slice(0, 2) });
    await expect(
      (async () => {
        for await (const _event of await client.appAgent.chat({ appId, hostUrl, messages })) {
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
        for await (const _event of await client.appAgent.chat({ appId, hostUrl, messages })) {
          /* consume */
        }
      })(),
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    expect(requests.filter((request) => request.url.endsWith("/chat"))).toHaveLength(1);
  });
});
