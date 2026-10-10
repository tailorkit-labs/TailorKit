import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { defineContract } from "../schema/contract";
import { tool } from "../schema/tools";
import { createServer } from "./contract";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
const issuer = "https://platform.test/api/platform";
const toolUrl = "https://product.test/api/tailorkit/tools/execute";
const identity = {
  installationId: "app",
  appId: "app",
  projectId: "project",
  deploymentId: "deployment",
  subjectId: "automation:billing",
  scope: { name: "org", value: { id: "tenant" } },
};
const handler = vi.fn(({ input, context }) => ({
  value: input + 1,
  principal: context.identity.subjectId ?? context.identity.installationId,
}));
const contract = defineContract({
  scopes: { org: z.object({ id: z.string() }) },
  tools: {
    ui: { open: tool.client().input(z.string()).output(z.string()) },
    math: {
      increment: tool
        .server()
        .input(z.string().transform(Number))
        .output(z.object({ value: z.number(), principal: z.string() })),
      broken: tool.server().output(z.number()),
      transformed: tool.server().output(z.string().transform(Number).pipe(z.number())),
    },
  },
});
const server = createServer({
  contract,
  authenticate: () => null,
  tools: {
    math: {
      increment: handler,
      broken: () => "invalid" as unknown as number,
      transformed: () => "42",
    },
  },
  $internal: {
    platformBaseUrl: issuer,
    platformHeaders: { authorization: "Bearer product-project-key" },
    platformFetch: async (url, init) => {
      if (String(url).endsWith("/runtime/keys"))
        return Response.json({ keys: [{ ...jwk, kid: "platform" }] });
      const request = url instanceof Request ? url : new Request(url, init);
      expect(request.headers.get("authorization")).toBe("Bearer product-project-key");
      expect(request.url).toBe(issuer + "/apps/app/lookup");
      expect(await request.json()).toEqual({ scopes: [identity.scope] });
      return Response.json({
        id: "app",
        projectId: "project",
        currentDeployment: { id: "deployment" },
      });
    },
  },
});
const encode = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
async function token(overrides: Record<string, unknown> = {}, privateKey = pair.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const data = new TextEncoder();
  const header = encode(data.encode(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "platform" })));
  const body = encode(
    data.encode(
      JSON.stringify({
        ...identity,
        publicTeamId: "team",
        appPublicId: "public-app",
        sub: identity.installationId,
        iss: issuer,
        aud: "tailorkit-app",
        purpose: "app",
        toolUrl,
        iat: now,
        exp: now + 300,
        ...overrides,
      }),
    ),
  );
  return (
    header +
    "." +
    body +
    "." +
    encode(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          privateKey,
          data.encode(header + "." + body),
        ),
      ),
    )
  );
}
async function execute(credential: string, path = "math.increment", ...args: [input?: unknown]) {
  const input = args.length ? args[0] : "41";
  return server.handler(
    new Request(toolUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      body: JSON.stringify({ path, input, requestId: "1a5febf3-e3af-4a01-89a7-35a4f1846114" }),
    }),
  );
}
it("validates transformed inputs and exposes verified installation, principal, scope and request ID", async () => {
  const response = await execute(await token());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ output: { value: 42, principal: identity.subjectId } });
  expect(handler.mock.calls.at(-1)?.[0]).toMatchObject({
    input: 41,
    context: { identity, scope: identity.scope, requestId: "1a5febf3-e3af-4a01-89a7-35a4f1846114" },
  });
});
it("attributes a call without a subject to its installation", async () => {
  const response = await execute(await token({ subjectId: undefined }));
  expect(await response.json()).toEqual({ output: { value: 42, principal: "app" } });
});
it.each([
  { iss: "https://attacker.test" },
  { aud: "another-service" },
  { purpose: "another-purpose" },
  { toolUrl: "https://other.test/tools" },
  { exp: 1 },
  { exp: Math.floor(Date.now() / 1000) + 601 },
  { iat: Math.floor(Date.now() / 1000) + 1 },
  { scope: { name: "other", value: {} } },
  { subjectId: 123 },
  { projectId: "other-project" },
  { deploymentId: "unpublished" },
  { installationId: "victim" },
])("rejects invalid signed claims %j", async (claims) => {
  const before = handler.mock.calls.length;
  expect((await execute(await token(claims))).status).toBe(401);
  expect(handler.mock.calls.length).toBe(before);
});
it("rejects a signature from an untrusted key", async () => {
  const attacker = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  expect((await execute(await token({}, attacker.privateKey))).status).toBe(401);
});
it("validates both directions and dispatches only declared server tools", async () => {
  expect((await execute(await token(), "math.increment", {})).status).toBe(400);
  expect((await execute(await token(), "math.broken", undefined)).status).toBe(500);
  expect((await execute(await token(), "ui.open")).status).toBe(404);
});
it("serializes nested kinds and schemas without implementations", () => {
  const metadata = server.$internal.schema.serialize();
  expect(metadata.tools).toMatchObject({
    ui: { open: { kind: "client", input: { type: "string" } } },
    math: { increment: { kind: "server", output: { type: "object" } } },
  });
  expect(JSON.stringify(metadata)).not.toContain("handler");
});
it("permits sandbox HTTP preflights without cookie credentials", async () => {
  const response = await server.handler(
    new Request(toolUrl, {
      method: "OPTIONS",
      headers: {
        origin: "null",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    }),
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
});

it("validates and transforms implementation output before returning it to callers", async () => {
  const response = await execute(await token(), "math.transformed", undefined);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ output: 42 });
});

it("accepts the same app session JWT across declared server tools", async () => {
  const session = await token();
  expect((await execute(session)).status).toBe(200);
  expect(await (await execute(session, "math.transformed", undefined)).json()).toEqual({
    output: 42,
  });
});
