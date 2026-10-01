import type { ORPCError } from "@orpc/server";
import { call } from "@orpc/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { RateLimitHandlerPlugin } from "@tailorkit/api-utils/rate-limiting";
import { app as appTable, appDeployment, appDeploymentFile } from "@tailorkit/db/schema/apps";
import { organization, user } from "@tailorkit/db/schema/auth";
import { project as projectTable } from "@tailorkit/db/schema/project";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Context } from "../context";
import { createTestDb } from "../test/pglite";

const testState = vi.hoisted(() => ({
  db: undefined as unknown,
  issueToken: vi.fn(async () => ({ token: "platform-token", expiresAt: Date.now() + 120_000 })),
}));

vi.mock("@tailorkit/kv", () => ({ getKV: () => undefined }));

vi.mock("@tailorkit/db", () => ({
  createDb: () => testState.db,
  get db() {
    return testState.db;
  },
}));

vi.mock("../app-runtime-auth", () => ({ issueAppRuntimeToken: testState.issueToken }));

const { appRouter } = await import("./apps");
const { canonicalizeScope } = await import("../scope");

const orgId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const otherProjectId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const productionScope = { name: "environment", value: { environment: "production" } };
const stagingScope = { name: "environment", value: { environment: "staging" } };

function createContext(overrides: Partial<Context> = {}): Context {
  return {
    organization: {
      publicId: "team0000000001",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: orgId,
      logo: null,
      metadata: null,
      name: "Analytical Engines",
      slug: "analytical-engines",
    },
    project: {
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      id: projectId,
      name: "Compiler",
      organizationId: orgId,
      slug: "compiler",
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    },
    storage: {
      type: "s3",
      createDownloadUrl: vi.fn(),
      createUploadUrl: vi.fn(),
      delete: vi.fn(),
      head: vi.fn(),
    },
    ...overrides,
  };
}

describe("platform appRouter", () => {
  let client: Awaited<ReturnType<typeof createTestDb>>["client"];
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];

  beforeEach(async () => {
    const testDb = await createTestDb();
    client = testDb.client;
    db = testDb.db;
    testState.db = db;

    await db.insert(user).values({
      id: userId,
      name: "Ada Lovelace",
      email: "ada@example.com",
      emailVerified: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await db.insert(organization).values({
      publicId: "team0000000001",
      id: orgId,
      name: "Analytical Engines",
      slug: "analytical-engines",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await db.insert(projectTable).values([
      {
        id: projectId,
        name: "Compiler",
        organizationId: orgId,
        slug: "compiler",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        id: otherProjectId,
        name: "Runtime",
        organizationId: orgId,
        slug: "runtime",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
    vi.clearAllMocks();
  });

  it("serves the existing OpenAPI create and lookup URLs with detailed inputs", async () => {
    const handler = new OpenAPIHandler(
      { apps: appRouter },
      { plugins: [new RateLimitHandlerPlugin()] },
    );
    const handle = (path: string, body: unknown) =>
      handler.handle(
        new Request(`https://example.com/api/platform${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { prefix: "/api/platform", context: createContext() },
      );

    const created = await handle("/apps", {
      name: "Compiler",
      description: null,
      scope: productionScope,
    });
    expect(created.response?.status).toBe(200);
    expect(created.response?.headers.get("ratelimit-limit")).toBe("100");
    const app = (await created.response?.json()) as { id: string };

    const found = await handle(`/apps/${app.id}/lookup`, { scopes: [productionScope] });
    expect(found.response?.status).toBe(200);
    await expect(found.response?.json()).resolves.toMatchObject({ id: app.id, name: "Compiler" });

    const missing = await handle("/apps/missing/lookup", { scopes: [productionScope] });
    expect(missing.response?.status).toBe(404);
    const error = await missing.response?.json();
    expect(error).toMatchObject({ code: "NOT_FOUND" });
    expect(error).not.toHaveProperty("status");
  });

  it("creates and lists apps within the authenticated project and scope", async () => {
    const context = createContext();

    const created = await call(
      appRouter.create,
      {
        body: {
          description: " Embedded inbox ",
          name: " Inbox ",
          scope: productionScope,
        },
      },
      { context },
    );

    expect(created.body).toEqual(
      expect.objectContaining({
        description: "Embedded inbox",
        name: "Inbox",
        projectId,
        publicId: expect.stringMatching(/^[0-9a-z]{12}$/u),
        scope: productionScope,
      }),
    );

    await db.insert(appTable).values({
      name: "Staging app",
      projectId,
      publicId: "staging001",
      ...canonicalizeScope(stagingScope),
    });

    const result = await call(
      appRouter.list,
      { body: { page: 1, pageSize: 10, scopes: [productionScope] } },
      { context },
    );

    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toEqual(expect.objectContaining({ id: created.body.id }));
  });

  it("returns the current published deployment", async () => {
    const context = createContext();
    const [createdApp] = await db
      .insert(appTable)
      .values({
        name: "Notes",
        projectId,
        publicId: "notes00001",
        ...canonicalizeScope(productionScope),
      })
      .returning();

    if (!createdApp) {
      throw new Error("Expected test app to be created.");
    }

    const [deployment] = await db
      .insert(appDeployment)
      .values({
        appId: createdApp.id,
        publicId: "deploy0001",
        status: "published",
      })
      .returning();

    if (!deployment) {
      throw new Error("Expected test deployment to be created.");
    }

    const [clientEntryFile] = await db
      .insert(appDeploymentFile)
      .values({
        appDeploymentId: deployment.id,
        checksum: "0".repeat(64),
        contentLength: 1,
        contentType: "application/javascript",
        encoding: "utf-8",
        objectKey: "client.js",
        status: "verified",
      })
      .returning();

    if (!clientEntryFile) {
      throw new Error("Expected client entry file to be created.");
    }

    await db
      .update(appDeployment)
      .set({ clientEntryFileId: clientEntryFile.id })
      .where(eq(appDeployment.id, deployment.id));

    await db
      .update(appTable)
      .set({ currentDeploymentId: deployment.id })
      .where(eq(appTable.id, createdApp.id));

    const result = await call(
      appRouter.list,
      { body: { page: 1, pageSize: 10, scopes: [productionScope] } },
      { context },
    );

    expect(result.body.items[0]?.currentDeployment?.id).toBe(deployment.id);
    expect(result.body.items[0]?.clientPath).toBe(
      `https://team0000000001.tailorkit.app/p/${projectId}/a/notes00001/d/deploy0001/client.js`,
    );
  });

  it("lists apps across selected named scopes with global ordering and pagination", async () => {
    const context = createContext();
    const teamScope = { name: "team", value: { teamId: "team_1" } };
    const userScope = { name: "user", value: { userId: "user_1" } };
    const excludedScope = { name: "team", value: { teamId: "team_2" } };
    const createdAt = (day: number) =>
      new Date(`2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`);

    await db.insert(appTable).values([
      {
        name: "Team app",
        projectId,
        publicId: "teamapp00001",
        createdAt: createdAt(3),
        ...canonicalizeScope(teamScope),
      },
      {
        name: "User app",
        projectId,
        publicId: "userapp00001",
        createdAt: createdAt(4),
        ...canonicalizeScope(userScope),
      },
      {
        name: "Other team app",
        projectId,
        publicId: "otherapp0001",
        createdAt: createdAt(5),
        ...canonicalizeScope(excludedScope),
      },
    ]);

    const firstPage = await call(
      appRouter.list,
      { body: { page: 1, pageSize: 1, scopes: [teamScope, userScope] } },
      { context },
    );
    const secondPage = await call(
      appRouter.list,
      { body: { page: 2, pageSize: 1, scopes: [teamScope, userScope] } },
      { context },
    );

    expect(firstPage.body.items.map(({ name }) => name)).toEqual(["User app"]);
    expect(secondPage.body.items.map(({ name }) => name)).toEqual(["Team app"]);
    expect(firstPage.body.pagination.hasMore).toBe(true);
    expect(secondPage.body.pagination.hasMore).toBe(false);
  });

  it("does not resolve apps outside the current project or scope", async () => {
    const [created] = await db
      .insert(appTable)
      .values({
        name: "Other project app",
        projectId: otherProjectId,
        publicId: "other00001",
        ...canonicalizeScope(productionScope),
      })
      .returning();

    if (!created) {
      throw new Error("Expected test app to be created.");
    }

    await expect(
      call(
        appRouter.get,
        { params: { appId: created.id }, body: { scopes: [productionScope] } },
        { context: createContext() },
      ),
    ).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND" } satisfies Partial<
        ORPCError<"NOT_FOUND", unknown>
      >),
    );

    const [otherScopeApp] = await db
      .insert(appTable)
      .values({
        name: "Staging app",
        projectId,
        publicId: "staging002",
        ...canonicalizeScope(stagingScope),
      })
      .returning();
    if (!otherScopeApp) {
      throw new Error("Expected staging app to be created.");
    }
    await expect(
      call(
        appRouter.get,
        { params: { appId: otherScopeApp.id }, body: { scopes: [productionScope] } },
        { context: createContext() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses the JSON body scope for app mutations", async () => {
    const context = createContext();
    const [created] = await db
      .insert(appTable)
      .values({
        id: "55555555-5555-7555-8555-555555555555",
        name: "Inbox",
        projectId,
        publicId: "inbox0000001",
        ...canonicalizeScope(productionScope),
      })
      .returning();
    if (!created) throw new Error("Expected test app to be created.");

    await expect(
      call(
        appRouter.update,
        {
          params: { appId: created.publicId },
          body: { name: "Wrong scope", description: null, scope: stagingScope },
        },
        { context },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const updated = await call(
      appRouter.update,
      {
        params: { appId: created.publicId },
        body: { name: "Updated inbox", description: null, scope: productionScope },
      },
      { context },
    );
    expect(updated.body.name).toBe("Updated inbox");

    const [deployment] = await db
      .insert(appDeployment)
      .values({ appId: created.id, publicId: "deploy0002", status: "published" })
      .returning();
    if (!deployment) throw new Error("Expected test deployment to be created.");

    const deployed = await call(
      appRouter.deploy,
      {
        params: { appId: created.publicId },
        body: { deploymentId: deployment.publicId, scope: productionScope },
      },
      { context },
    );
    expect(deployed.body.currentDeployment?.id).toBe(deployment.id);

    const input = {
      params: { appId: created.publicId },
      body: {
        scopes: [productionScope],
        userId: "verified-user",
        installationId: "installation",
        deploymentId: deployment.id,
      },
    };
    const session = await call(appRouter.runtimeSession, input, { context });
    expect(session.body.token).toBe("platform-token");
    expect(testState.issueToken).toHaveBeenCalledWith({
      userId: "verified-user",
      installationId: "installation",
      appId: created.id,
      projectId,
      deploymentId: deployment.id,
    });
    await expect(
      call(
        appRouter.runtimeSession,
        { ...input, body: { ...input.body, scopes: [stagingScope] } },
        { context },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(appRouter.runtimeSession, input, {
        context: { ...context, project: { ...context.project, id: otherProjectId } },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(
        appRouter.runtimeSession,
        { ...input, body: { ...input.body, deploymentId: "old" } },
        { context },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const deleted = await call(
      appRouter.delete,
      { params: { appId: created.publicId }, body: { scope: productionScope } },
      { context },
    );
    expect(deleted.body.id).toBe(created.id);
  });
});
