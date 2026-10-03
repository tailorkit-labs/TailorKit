import { call } from "@orpc/server";
import { organization } from "@tailorkit/db/schema/auth";
import { cliAuthSession, cliToken } from "@tailorkit/db/schema/cli-auth";
import { project as projectTable } from "@tailorkit/db/schema/project";
import { env } from "#env";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Context } from "../context";
import { createTestDb } from "../test/pglite";

vi.mock("@tailorkit/kv", () => ({ getKV: () => null }));

const testState = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@tailorkit/db", () => ({
  createDb: () => testState.db,
  get db() {
    return testState.db;
  },
}));

const { cliAuthRouter } = await import("./cli-auth");

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const scope = {
  name: "user",
  value: { userId: "user_456", organizationId: "org_123" },
};
const expectedScope = {
  name: "user",
  value: { organizationId: "org_123", userId: "user_456" },
};
const expectedScopeKey = "83f6cbb3372e91fda7451be1728a9e91";

function createContext(): Context {
  return {
    organization: {
      id: organizationId,
      publicId: "team0000000001",
      name: "Analytical Engines",
      slug: "analytical-engines",
      logo: null,
      metadata: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    project: {
      id: projectId,
      organizationId,
      name: "Compiler",
      slug: "compiler",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    },
    storage: {
      type: "s3",
      createUploadUrl: vi.fn(),
      createDownloadUrl: vi.fn(),
      delete: vi.fn(),
      head: vi.fn(),
    },
  };
}

describe("platform CLI auth scopes", () => {
  let client: Awaited<ReturnType<typeof createTestDb>>["client"];
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];

  beforeEach(async () => {
    if (!env.AUTH_SECRET) {
      throw new Error("The CLI auth test requires AUTH_SECRET in its Vitest config.");
    }
    const testDb = await createTestDb();
    client = testDb.client;
    db = testDb.db;
    testState.db = db;

    await db.insert(organization).values({
      id: organizationId,
      publicId: "team0000000001",
      name: "Analytical Engines",
      slug: "analytical-engines",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await db.insert(projectTable).values({
      id: projectId,
      organizationId,
      name: "Compiler",
      slug: "compiler",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
  });

  afterEach(async () => {
    await client.close();
    vi.clearAllMocks();
  });

  it("stores and returns the exact structured scope when issuing a CLI token", async () => {
    const context = createContext();
    const started = await call(cliAuthRouter.start, { body: {} }, { context });
    await call(
      cliAuthRouter.approve,
      { body: { scope, userCode: started.body.userCode } },
      { context },
    );

    const polled = await call(
      cliAuthRouter.poll,
      { body: { deviceCode: started.body.deviceCode } },
      { context },
    );
    if (polled.body.status !== "approved") {
      throw new Error("Expected CLI auth session to be approved.");
    }
    expect(polled.body).toEqual({
      deployToken: expect.any(String),
      scope: expectedScope,
      status: "approved",
    });

    const verified = await call(
      cliAuthRouter.verifyToken,
      { body: { deployToken: polled.body.deployToken } },
      { context },
    );
    expect(verified.body).toEqual({ scope: expectedScope });

    const token = await db.query.cliToken.findFirst();
    expect(token).toEqual(
      expect.objectContaining({
        scope: expectedScope,
        scopeKey: expectedScopeKey,
      }),
    );
  });

  it("rejects malformed stored scopes in approved sessions and deploy tokens", async () => {
    const context = createContext();
    const started = await call(cliAuthRouter.start, { body: {} }, { context });
    await call(
      cliAuthRouter.approve,
      { body: { scope, userCode: started.body.userCode } },
      { context },
    );
    const session = await db.query.cliAuthSession.findFirst();
    if (!session) throw new Error("Expected CLI auth session.");
    await db
      .update(cliAuthSession)
      .set({ scope: { name: "user", value: {} } })
      .where(eq(cliAuthSession.id, session.id));
    await expect(
      call(cliAuthRouter.poll, { body: { deviceCode: started.body.deviceCode } }, { context }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await db
      .update(cliAuthSession)
      .set({ scope: expectedScope, scopeKey: "0".repeat(32) })
      .where(eq(cliAuthSession.id, session.id));
    await expect(
      call(cliAuthRouter.poll, { body: { deviceCode: started.body.deviceCode } }, { context }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await db
      .update(cliAuthSession)
      .set({ scope: expectedScope, scopeKey: expectedScopeKey })
      .where(eq(cliAuthSession.id, session.id));
    const polled = await call(
      cliAuthRouter.poll,
      { body: { deviceCode: started.body.deviceCode } },
      { context },
    );
    if (polled.body.status !== "approved") throw new Error("Expected approved CLI token.");
    const token = await db.query.cliToken.findFirst();
    if (!token) throw new Error("Expected CLI token.");
    await db
      .update(cliToken)
      .set({ scope: { name: "user", value: {} } })
      .where(eq(cliToken.id, token.id));
    await expect(
      call(
        cliAuthRouter.verifyToken,
        { body: { deployToken: polled.body.deployToken } },
        { context },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await db
      .update(cliToken)
      .set({ scope: expectedScope, scopeKey: "0".repeat(32) })
      .where(eq(cliToken.id, token.id));
    await expect(
      call(
        cliAuthRouter.verifyToken,
        { body: { deployToken: polled.body.deployToken } },
        { context },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
