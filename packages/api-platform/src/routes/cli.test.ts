import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { app, appDeployment } from "@tailorkit/db/schema/apps";
import { cliToken } from "@tailorkit/db/schema/cli-auth";
import { organization } from "@tailorkit/db/schema/auth";
import { project } from "@tailorkit/db/schema/project";
import { env } from "#env";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createTestDb } from "../test/pglite";
import { canonicalizeScope } from "../scope";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  apiKey: vi.fn(),
  storage: {
    type: "s3",
    createUploadUrl: vi.fn(),
    createDownloadUrl: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("@tailorkit/db", () => ({
  get db() {
    return mocks.db;
  },
}));
vi.mock("@tailorkit/auth", () => ({ auth: { api: { verifyApiKey: mocks.apiKey } } }));
vi.mock("@tailorkit/storage", () => ({ getStorage: () => mocks.storage }));
vi.mock("@tailorkit/kv", () => ({ getKV: () => null }));

const { createCliContext } = await import("../context");
const { cliRouter } = await import("./cli");
const { deploymentRouter } = await import("./deployments");
const handler = new OpenAPIHandler({ cli: cliRouter, deployments: deploymentRouter });
const projectId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const tokenSecret = "issued-cli-token";
const scope = canonicalizeScope({ name: "user", value: { userId: "user-one" } });
let database: Awaited<ReturnType<typeof createTestDb>>;
let authorizedAppId: string;
let otherScopeAppId: string;
let otherProjectAppId: string;

function request(path: string, body: unknown = {}, secret = tokenSecret) {
  return new Request(`https://platform.test/api/platform${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function post(path: string, body: unknown = {}) {
  const input = request(path, body);
  const context = await createCliContext({ request: input });
  const result = await handler.handle(input, { prefix: "/api/platform", context });
  if (!result.response) throw new Error("Expected HTTP response");
  return { status: result.response.status, body: await result.response.json() };
}
const deploymentInput = (appId: string) => ({
  appId,
  assets: [
    {
      checksum: "a".repeat(64),
      contentLength: 10,
      contentType: "application/javascript",
      encoding: "gzip",
      objectKey: "client.js",
    },
  ],
});

beforeEach(async () => {
  vi.clearAllMocks();
  database = await createTestDb();
  mocks.db = database.db;
  const db = database.db;
  await db.insert(organization).values({
    id: organizationId,
    publicId: "team0000000001",
    name: "Team",
    slug: "team",
    createdAt: new Date(),
  });
  const otherProjectId = "33333333-3333-4333-8333-333333333333";
  await db.insert(project).values([
    { id: projectId, organizationId, name: "Project", slug: "project" },
    { id: otherProjectId, organizationId, name: "Other", slug: "other" },
  ]);
  await db.insert(cliToken).values({
    projectId,
    ...scope,
    tokenHash: hashSecret(tokenSecret, env.AUTH_SECRET!),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const apps = await db
    .insert(app)
    .values([
      { projectId, ...scope, name: "Allowed", publicId: "app000000001" },
      {
        projectId,
        ...canonicalizeScope({ name: "user", value: { userId: "user-two" } }),
        name: "Other scope",
        publicId: "app000000002",
      },
      { projectId: otherProjectId, ...scope, name: "Other project", publicId: "app000000003" },
    ])
    .returning();
  authorizedAppId = apps[0]!.id;
  otherScopeAppId = apps[1]!.id;
  otherProjectAppId = apps[2]!.id;
  mocks.storage.createUploadUrl.mockResolvedValue({ uploadUrl: "https://uploads.test/client.js" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database.client.close();
});

it("derives project and scope from the CLI token without a host key", async () => {
  expect(await post("/cli/verify")).toEqual({
    status: 200,
    body: { projectId, scope: scope.scope },
  });
  expect(mocks.apiKey).not.toHaveBeenCalled();
  const createdApp = await post("/cli/apps", { name: "New app", description: null });
  expect(createdApp.status).toBe(200);
  expect(createdApp.body).toMatchObject({ projectId, scope: scope.scope });
  const created = await post("/cli/deployments", deploymentInput(authorizedAppId));
  expect(created.status).toBe(200);
  expect(created.body.deployment).toMatchObject({ appId: authorizedAppId, status: "uploading" });
});

it.each(["expired", "revoked", "invalid", "malformed-scope"])(
  "rejects %s tokens",
  async (state) => {
    if (state === "expired") await database.db.update(cliToken).set({ expiresAt: new Date(0) });
    if (state === "revoked") await database.db.update(cliToken).set({ revokedAt: new Date() });
    if (state === "malformed-scope")
      await database.db.update(cliToken).set({ scopeKey: "0".repeat(32) });
    await expect(
      createCliContext({
        request: request("/cli/verify", {}, state === "invalid" ? "bad" : tokenSecret),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  },
);

it("cannot choose a different scope or access host project-key routes", async () => {
  expect(
    await post("/cli/deployments", {
      ...deploymentInput(authorizedAppId),
      scope: { name: "user", value: { userId: "user-two" } },
    }),
  ).toMatchObject({ status: 400, body: { code: "BAD_REQUEST" } });
  expect(
    await post("/deployments", { ...deploymentInput(authorizedAppId), scope: scope.scope }),
  ).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
});

it("hides apps and deployments outside the token's scope or project", async () => {
  for (const appId of [otherScopeAppId, otherProjectAppId]) {
    expect(await post("/cli/deployments", deploymentInput(appId))).toMatchObject({
      status: 404,
      body: { code: "NOT_FOUND" },
    });
    const [deployment] = await database.db
      .insert(appDeployment)
      .values({ appId, publicId: appId.slice(0, 12), status: "uploading" })
      .returning();
    expect(await post(`/cli/deployments/${deployment!.id}`, {})).toMatchObject({
      status: 404,
      body: { code: "NOT_FOUND" },
    });
  }
});

it("publishes a verified upload to the authorized app", async () => {
  const created = await post("/cli/deployments", deploymentInput(authorizedAppId));
  mocks.storage.head.mockResolvedValue({
    contentLength: 10,
    contentType: "application/javascript",
    contentEncoding: "gzip",
    checksumSha256: Buffer.from("a".repeat(64), "hex").toString("base64"),
  });
  mocks.storage.createDownloadUrl.mockResolvedValue({ url: "https://uploads.test/client.js" });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("client-code"));
  const published = await post(`/cli/deployments/${created.body.deployment.id}`, { rollout: true });
  expect(published).toMatchObject({ status: 200, body: { status: "published" } });
  const selectedApp = await database.db.query.app.findFirst({ where: { id: authorizedAppId } });
  expect(selectedApp?.currentDeploymentId).toBe(created.body.deployment.id);
  const otherApp = await database.db.query.app.findFirst({ where: { id: otherScopeAppId } });
  expect(otherApp?.currentDeploymentId).toBeNull();
});
