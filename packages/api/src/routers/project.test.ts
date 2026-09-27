import type { ORPCError } from "@orpc/server";
import { call } from "@orpc/server";
import { auth } from "@tailorkit/auth";
import { organization, member, user } from "@tailorkit/db/schema/auth";
import { project } from "@tailorkit/db/schema/project";
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
  isOrgSlugReserved: () => false,
}));

vi.mock("@tailorkit/auth", () => ({
  auth: {
    api: {
      createApiKey: vi.fn(() => Promise.resolve({ id: "api-key-id", key: "tk_proj_secret" })),
      deleteApiKey: vi.fn(),
      hasPermission: vi.fn(() => Promise.resolve({ success: true })),
      updateApiKey: vi.fn(),
    },
  },
}));

const { projectRouter } = await import("./project");

const userId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const otherOrgId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";

function createContext(overrides: Partial<Context> = {}): Context {
  return {
    headers: new Headers(),
    ip: "127.0.0.1",
    session: {
      activeOrganizationId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-02-01T00:00:00.000Z"),
      id: "session-id",
      ipAddress: null,
      token: "session-token",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      userAgent: null,
      userId,
    },
    user: {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      email: "ada@example.com",
      emailVerified: true,
      id: userId,
      image: null,
      name: "Ada Lovelace",
      theme: "system",
      twoFactorEnabled: false,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    ...overrides,
  };
}

describe("projectRouter", () => {
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

    await db.insert(organization).values([
      {
        id: orgId,
        name: "Analytical Engines",
        slug: "analytical-engines",
        publicId: "team0000000001",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: otherOrgId,
        name: "Compilers Inc",
        slug: "compilers-inc",
        publicId: "team0000000002",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    await db.insert(member).values({
      id: "55555555-5555-4555-8555-555555555555",
      organizationId: orgId,
      userId,
      role: "owner",
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    });

    await db.insert(project).values([
      {
        id: projectId,
        organizationId: orgId,
        name: "Compiler",
        slug: "compiler",
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        updatedAt: new Date("2026-01-04T00:00:00.000Z"),
      },
      {
        organizationId: otherOrgId,
        name: "Runtime",
        slug: "runtime",
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        updatedAt: new Date("2026-01-04T00:00:00.000Z"),
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
    vi.clearAllMocks();
  });

  it("lists projects only for organizations the user belongs to", async () => {
    const projects = await call(
      projectRouter.list,
      { orgSlug: "analytical-engines" },
      { context: createContext() },
    );

    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual(expect.objectContaining({ id: projectId, slug: "compiler" }));
  });

  it("rejects projects in organizations outside the current user's membership", async () => {
    await expect(
      call(projectRouter.list, { orgSlug: "compilers-inc" }, { context: createContext() }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND" } satisfies Partial<
        ORPCError<"NOT_FOUND", unknown>
      >),
    );
  });

  it("validates duplicate project slugs within an organization", async () => {
    await expect(
      call(
        projectRouter.create,
        { name: "Compiler Two", orgSlug: "analytical-engines", slug: "compiler" },
        { context: createContext() },
      ),
    ).rejects.toEqual(
      expect.objectContaining({ code: "BAD_REQUEST" } satisfies Partial<
        ORPCError<"BAD_REQUEST", unknown>
      >),
    );
  });

  it("creates reusable host project API keys from the server auth instance", async () => {
    await call(
      projectRouter.create,
      { name: "Analyzer", orgSlug: "analytical-engines", slug: "analyzer" },
      { context: createContext() },
    );

    expect(auth.api.createApiKey).toHaveBeenCalledWith({
      body: expect.objectContaining({
        configId: "project-host",
        userId,
      }),
    });
  });

  it("uses a high backstop rate limit on host project API keys", async () => {
    await call(
      projectRouter.create,
      { name: "Analyzer", orgSlug: "analytical-engines", slug: "analyzer" },
      { context: createContext() },
    );

    expect(auth.api.createApiKey).toHaveBeenCalledWith({
      body: expect.objectContaining({
        configId: "project-host",
        rateLimitEnabled: true,
        rateLimitMax: 1000,
        rateLimitTimeWindow: 1000,
      }),
    });
  });

  it("uses a stable generated API key name independent of project names", async () => {
    await call(
      projectRouter.create,
      {
        name: "A very long project name that should still be allowed",
        orgSlug: "analytical-engines",
        slug: "long-project-name",
      },
      { context: createContext() },
    );

    expect(auth.api.createApiKey).toHaveBeenCalledWith({
      body: expect.objectContaining({
        name: "Project host key",
      }),
    });
  });
});
