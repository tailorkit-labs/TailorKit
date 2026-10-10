import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { defineContract, tool } from "@tailorkit/core/schema";
import { createEndpointClient } from "./endpoints";
import type { TailorKitApp } from "../types";
const app = { id: "installed-app" } as TailorKitApp;
const contract = defineContract({
  scopes: { workspace: z.object({ id: z.string() }) },
  tools: {
    ui: {
      select: tool
        .client()
        .input(z.string().transform((value) => value.length))
        .output(z.number()),
    },
    data: { read: tool.server().output(z.number()) },
  },
});
const identity = {
  installationId: app.id,
  appId: app.id,
  subjectId: "job:refresh",
  scope: { name: "workspace", value: { id: "workspace" } },
  projectId: "project",
  deploymentId: "deployment",
  toolUrl: "https://product.test/tools",
  expiresAt: Date.now() + 300_000,
};
it("binds client tool calls to the installation and validates transformed inputs and outputs", async () => {
  const implementation = vi.fn(({ input }) => input + 1);
  const bodies: unknown[] = [];
  const client = createEndpointClient({
    contract,
    baseUrl: "https://product.test/api/tailorkit/",
    tools: { ui: { select: implementation } },
    fetch: async (_url, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      return Response.json({
        subjectId: identity.subjectId,
        token: "verified-token",
        url: "https://runtime.test/rpc",
        toolUrl: identity.toolUrl,
        expiresAt: identity.expiresAt,
        identity,
      });
    },
  });
  const bridge = client.getToolBridge(app);
  expect(await bridge.client("ui.select", "test")).toBe(5);
  const credential = await bridge.session("data.read");
  const backendSession = await client.getSessionProvider(app)({ refresh: false });
  expect(credential.token).toBe(backendSession.token);
  expect(credential.url).toBe(identity.toolUrl);
  expect(backendSession.url).toBe("https://runtime.test/rpc");
  expect(bodies).toEqual([{ appId: app.id }]);
  expect(Object.isFrozen(implementation.mock.calls[0]?.[0].context.identity.scope.value)).toBe(
    true,
  );
  expect(implementation.mock.calls[0]?.[0]).toMatchObject({
    input: 4,
    context: { identity, scope: identity.scope },
  });
  await expect(bridge.client("data.read", undefined)).rejects.toThrow("Not a client tool");
  await expect(bridge.client("ui.select", 1)).rejects.toThrow("Invalid tool payload");
  implementation.mockImplementation(() => "invalid" as unknown as number);
  await expect(bridge.client("ui.select", "test")).rejects.toThrow("Invalid tool payload");
});
it("discards a pending credential when the session cache is cleared", async () => {
  let complete!: (response: Response) => void;
  const client = createEndpointClient({
    contract,
    baseUrl: "https://product.test/api/tailorkit/",
    fetch: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  const pending = client.getToolBridge(app).session("data.read");
  client.clearSessions();
  complete(
    Response.json({
      subjectId: identity.subjectId,
      token: "old-subject",
      url: "https://runtime.test/rpc",
      toolUrl: identity.toolUrl,
      expiresAt: identity.expiresAt,
      identity,
    }),
  );
  await expect(pending).rejects.toThrow("The app session was invalidated");
});
