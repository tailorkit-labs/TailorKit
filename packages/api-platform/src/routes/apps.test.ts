import type { ORPCError } from "@orpc/server";
import { call } from "@orpc/server";
import { app as appTable, appDeployment, appDeploymentFile } from "@tailorkit/db/schema/apps";
import { organization, user } from "@tailorkit/db/schema/auth";
import { project as projectTable } from "@tailorkit/db/schema/project";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Context } from "../context";
import { createTestDb } from "../test/pglite";

const testState = vi.hoisted(() => ({
  db: undefined as unknown,
}));

vi.mock("@tailorkit/db", () => ({
  createDb: () => testState.db,
  get db() {
    return testState.db;
  },
}));

const { appRouter } = await import("./apps");

const orgId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const otherProjectId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

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

  it("creates and lists apps within the authenticated project and scope", async () => {
    const context = createContext();

    const created = await call(
      appRouter.create,
      {
        body: {
          description: " Embedded inbox ",
          name: " Inbox ",
          scopeId: "production",
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
        scopeId: "production",
      }),
    );

    await db.insert(appTable).values({
      name: "Staging app",
      projectId,
      publicId: "staging001",
      scopeId: "staging",
    });

    const result = await call(
      appRouter.list,
      { query: { page: 1, pageSize: 10, scopeId: "production" } },
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
        scopeId: "production",
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
      { query: { page: 1, pageSize: 10, scopeId: "production" } },
      { context },
    );

    expect(result.body.items[0]?.currentDeployment?.id).toBe(deployment.id);
    expect(result.body.items[0]?.clientPath).toBe(
      `https://team0000000001.tailorkit.app/p/${projectId}/a/notes00001/d/deploy0001/client.js`,
    );
  });

  it("does not resolve apps outside the current project or scope", async () => {
    const [created] = await db
      .insert(appTable)
      .values({
        name: "Other project app",
        projectId: otherProjectId,
        publicId: "other00001",
        scopeId: "production",
      })
      .returning();

    if (!created) {
      throw new Error("Expected test app to be created.");
    }

    await expect(
      call(
        appRouter.get,
        { params: { appId: created.id }, query: { scopeId: "production" } },
        { context: createContext() },
      ),
    ).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND" } satisfies Partial<
        ORPCError<"NOT_FOUND", unknown>
      >),
    );
  });
});
