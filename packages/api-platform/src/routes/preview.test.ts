/* oxlint-disable require-await, typescript/no-non-null-assertion -- the in-memory KV fake implements Promise methods. */
import { call } from "@orpc/server";
import { app as appTable } from "@tailorkit/db/schema/apps";
import { organization } from "@tailorkit/db/schema/auth";
import { cliToken } from "@tailorkit/db/schema/cli-auth";
import { previewSession } from "@tailorkit/db/schema/preview-session";
import { project as projectTable } from "@tailorkit/db/schema/project";
import { env } from "#env";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Context } from "../context";
import { createTestDb } from "../test/pglite";

const state = vi.hoisted(() => ({ db: undefined as unknown, kv: undefined as unknown }));
vi.mock("@tailorkit/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@tailorkit/kv", async (original) => ({ ...(await original()), getKV: () => state.kv }));

const { previewRouter } = await import("./preview");
const { authorizePreviewSocket } = await import("../preview-ws-auth");
const { previewWebSocketRouter } = await import("../preview-ws");
const authSecret = env.AUTH_SECRET;
if (!authSecret) {
  throw new Error("The preview test requires AUTH_SECRET in its Vitest config.");
}
const orgId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const tokenId = "33333333-3333-4333-8333-333333333333";

function fakeKV() {
  const data = new Map<string, string>();
  return {
    get: async (key: string) => data.get(key) ?? null,
    getAndDelete: async (key: string) => {
      const value = data.get(key) ?? null;
      data.delete(key);
      return value;
    },
    setPreviewPresenceIfActive: async (
      presenceKey: string,
      seenKey: string,
      endedKey: string,
      value: string,
    ) => {
      if (data.has(endedKey)) {
        return false;
      }
      data.set(presenceKey, value);
      data.set(seenKey, "1");
      return true;
    },
    keepPreviewSessionIfDeveloperPresent: async (
      presenceKey: string,
      seenKey: string,
      endedKey: string,
      _endedTtl: number,
      expireUnseen = false,
    ) => {
      if (data.has(endedKey)) {
        return false;
      }
      if (data.has(presenceKey) || (!data.has(seenKey) && !expireUnseen)) {
        return true;
      }
      data.set(endedKey, "1");
      return false;
    },
    set: async (key: string, value: string) => {
      data.set(key, value);
    },
    delete: async (key: string) => {
      data.delete(key);
    },
    publish: async () => 0,
    subscribe: async () => async () => {},
    increment: async () => 1,
  };
}

const context: Context = {
  organization: {
    id: orgId,
    publicId: "team0000000001",
    name: "Team",
    slug: "team",
    logo: null,
    metadata: null,
    createdAt: new Date(),
  },
  project: {
    id: projectId,
    organizationId: orgId,
    name: "Project",
    slug: "project",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  storage: {
    type: "s3",
    createUploadUrl: vi.fn(),
    createDownloadUrl: vi.fn(),
    delete: vi.fn(),
    head: vi.fn(),
  },
};

describe("platform preview lifecycle and grants", () => {
  let client: Awaited<ReturnType<typeof createTestDb>>["client"];
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];
  beforeEach(async () => {
    const testDb = await createTestDb();
    client = testDb.client;
    db = testDb.db;
    state.db = db;
    state.kv = fakeKV();
    await db.insert(organization).values({
      id: orgId,
      publicId: "team0000000001",
      name: "Team",
      slug: "team",
      createdAt: new Date(),
    });
    await db.insert(projectTable).values({
      id: projectId,
      organizationId: orgId,
      name: "Project",
      slug: "project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { hashSecret } = await import("@tailorkit/api-utils/hashing");
    await db.insert(cliToken).values({
      id: tokenId,
      projectId,
      scopeId: "author",
      tokenHash: hashSecret("deploy-token", authSecret),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(appTable).values([
      { projectId, publicId: "authapp00001", name: "Author app", scopeId: "author" },
      { projectId, publicId: "otherapp0001", name: "Other app", scopeId: "other" },
    ]);
  });
  afterEach(async () => {
    await client.close();
    vi.clearAllMocks();
  });

  const start = () =>
    call(
      previewRouter.start,
      { body: { appId: "authapp00001", deployToken: "deploy-token" } },
      { context },
    );

  it("enforces author scope, active uniqueness, expiry retirement, and CLI revocation", async () => {
    await expect(
      call(
        previewRouter.start,
        { body: { appId: "otherapp0001", deployToken: "deploy-token" } },
        { context },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const first = await start();
    expect(first.body.shareId).toHaveLength(43);
    expect(first.body.tunnelUrl).toContain("/api/platform/preview/ws");
    await expect(start()).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "ACTIVE_PREVIEW_EXISTS" },
    });
    const kv = state.kv as ReturnType<typeof fakeKV>;
    const expiredBuildId = "expired_build";
    const manifest = {
      files: [
        {
          path: "client.js",
          contentType: "text/javascript",
          size: 1,
          chunks: 1,
          sha256: "0".repeat(64),
        },
      ],
    };
    const buildKey = `preview:build:${first.body.sessionId}:${expiredBuildId}`;
    await kv.set(
      `preview:current:${first.body.sessionId}`,
      JSON.stringify({ buildId: expiredBuildId, manifest, revision: 1 }),
    );
    await kv.set(buildKey, JSON.stringify({ state: "ready", manifest, revision: 1 }));
    await kv.set(`${buildKey}:0:0`, "YQ==");
    await db
      .update(previewSession)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(previewSession.id, first.body.sessionId));
    const second = await start();
    expect(second.body.sessionId).not.toBe(first.body.sessionId);
    expect(await kv.get(`preview:current:${first.body.sessionId}`)).toBeNull();
    expect(await kv.get(buildKey)).toBeNull();
    expect(await kv.get(`${buildKey}:0:0`)).toBeNull();
    expect(await kv.get(`preview:ended:${first.body.sessionId}`)).toBe("1");
    await db.update(cliToken).set({ revokedAt: new Date() }).where(eq(cliToken.id, tokenId));
    await expect(start()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      await authorizePreviewSocket(second.body.sessionId, second.body.tunnelToken, "uploader"),
    ).toBeNull();
    const revokedSession = await db.query.previewSession.findFirst({
      where: { id: second.body.sessionId },
    });
    expect(revokedSession?.status).toBe("ended");
    expect(await kv.get(`preview:ended:${second.body.sessionId}`)).toBe("1");
  });

  it("retires a session when its CLI token expires during a heartbeat", async () => {
    const started = await start();
    await db
      .update(cliToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(cliToken.id, tokenId));

    await expect(
      call(previewWebSocketRouter.heartbeat, undefined, {
        context: { sessionId: started.body.sessionId, role: "uploader" },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Preview CLI token is unavailable." });
    const session = await db.query.previewSession.findFirst({
      where: { id: started.body.sessionId },
    });
    expect(session?.status).toBe("ended");
    expect(
      await (state.kv as ReturnType<typeof fakeKV>).get(`preview:ended:${started.body.sessionId}`),
    ).toBe("1");
  });

  it("retires a disconnected developer before checking the app conflict", async () => {
    const first = await start();
    const kv = state.kv as ReturnType<typeof fakeKV>;
    await kv.set(`preview:developer-seen:${first.body.sessionId}`, "1");
    await kv.set(`preview:developer-connection:${first.body.sessionId}`, "connected");
    await expect(start()).rejects.toMatchObject({ code: "CONFLICT" });

    await kv.delete(`preview:developer-connection:${first.body.sessionId}`);
    const replacement = await start();
    expect(replacement.body.sessionId).not.toBe(first.body.sessionId);
    expect(await kv.get(`preview:ended:${first.body.sessionId}`)).toBe("1");
    const oldSession = await db.query.previewSession.findFirst({
      where: { id: first.body.sessionId },
    });
    expect(oldSession?.status).toBe("ended");
  });

  it("retires a session that never connected after its first-connection grace", async () => {
    const first = await start();
    await expect(start()).rejects.toMatchObject({ code: "CONFLICT" });
    await db
      .update(previewSession)
      .set({ createdAt: new Date(Date.now() - 3 * 60 * 1000) })
      .where(eq(previewSession.id, first.body.sessionId));

    const replacement = await start();
    expect(replacement.body.sessionId).not.toBe(first.body.sessionId);
    const kv = state.kv as ReturnType<typeof fakeKV>;
    expect(await kv.get(`preview:ended:${first.body.sessionId}`)).toBe("1");
  });

  it("binds grants to the viewer scope and invalidates them on stop", async () => {
    const started = await start();
    const accepted = await call(
      previewRouter.accept,
      { params: { shareId: started.body.shareId }, body: { scopeId: "viewer" } },
      { context },
    );
    const wrongScope = await call(
      previewRouter.accepted,
      { body: { grantIds: [accepted.body.grantId], scopeId: "other" } },
      { context },
    );
    expect(wrongScope.body.items).toEqual([]);
    const viewer = await call(
      previewRouter.accepted,
      { body: { grantIds: [accepted.body.grantId], scopeId: "viewer" } },
      { context },
    );
    expect(viewer.body.items).toHaveLength(1);
    expect(viewer.body.items[0]?.preview.token).toBeTruthy();
    await call(
      previewRouter.stop,
      { params: { sessionId: started.body.sessionId }, body: { deployToken: "deploy-token" } },
      { context },
    );
    const ended = await call(
      previewRouter.accepted,
      { body: { grantIds: [accepted.body.grantId], scopeId: "viewer" } },
      { context },
    );
    expect(ended.body.items).toEqual([]);
  });

  it("retries KV cleanup after the session was durably stopped", async () => {
    const started = await start();
    const kv = state.kv as ReturnType<typeof fakeKV>;
    const buildId = "retry_build";
    const buildKey = `preview:build:${started.body.sessionId}:${buildId}`;
    const chunkKey = `${buildKey}:0:0`;
    const manifest = {
      files: [
        {
          path: "client.js",
          contentType: "text/javascript",
          size: 1,
          chunks: 1,
          sha256: "0".repeat(64),
        },
      ],
    };
    await kv.set(
      `preview:current:${started.body.sessionId}`,
      JSON.stringify({ buildId, manifest, revision: 1 }),
    );
    await kv.set(buildKey, JSON.stringify({ state: "ready", manifest, revision: 1 }));
    await kv.set(chunkKey, "YQ==");
    const remove = kv.delete;
    let failOnce = true;
    kv.delete = async (key) => {
      if (key === chunkKey && failOnce) {
        failOnce = false;
        throw new Error("KV cleanup failed");
      }
      await remove(key);
    };
    const stop = () =>
      call(
        previewRouter.stop,
        { params: { sessionId: started.body.sessionId }, body: { deployToken: "deploy-token" } },
        { context },
      );

    await expect(stop()).rejects.toThrow("KV cleanup failed");
    const session = await db.query.previewSession.findFirst({
      where: { id: started.body.sessionId },
    });
    expect(session?.status).toBe("ended");
    expect(await kv.get(`preview:current:${started.body.sessionId}`)).not.toBeNull();
    await expect(stop()).resolves.toEqual({ body: {} });
    expect(await kv.get(`preview:current:${started.body.sessionId}`)).toBeNull();
    expect(await kv.get(buildKey)).toBeNull();
    expect(await kv.get(chunkKey)).toBeNull();
  });

  it("ends an idle viewer stream when its bearer token expires", async () => {
    const started = await start();
    const stream = await call(previewWebSocketRouter.subscribe, undefined, {
      context: {
        sessionId: started.body.sessionId,
        role: "viewer",
        viewerTokenExpiresAt: Date.now() + 30,
      },
    });
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("allows five active apps per scope, retires expired sessions, and frees a slot on stop", async () => {
    const appIds = Array.from(
      { length: 7 },
      (_, index) => `scopeapp${String(index).padStart(4, "0")}`,
    );
    await db
      .insert(appTable)
      .values(
        appIds.map((publicId) => ({ projectId, publicId, name: publicId, scopeId: "author" })),
      );
    const startApp = (appId: string) =>
      call(previewRouter.start, { body: { appId, deployToken: "deploy-token" } }, { context });
    const started = await Promise.all(appIds.slice(0, 5).map(startApp));
    await expect(startApp(appIds[5]!)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This scope already has 5 active previews.",
    });
    const { hashSecret } = await import("@tailorkit/api-utils/hashing");
    await db.insert(cliToken).values({
      id: "44444444-4444-4444-8444-444444444444",
      projectId,
      scopeId: "other",
      tokenHash: hashSecret("other-token", authSecret),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const otherScope = await call(
      previewRouter.start,
      { body: { appId: "otherapp0001", deployToken: "other-token" } },
      { context },
    );
    expect(otherScope.body.sessionId).toBeTruthy();
    await db
      .update(previewSession)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(previewSession.id, started[0]!.body.sessionId));
    const replacement = await startApp(appIds[5]!);
    expect(replacement.body.sessionId).toBeTruthy();
    await expect(startApp(appIds[6]!)).rejects.toMatchObject({ code: "CONFLICT" });
    await call(
      previewRouter.stop,
      { params: { sessionId: started[1]!.body.sessionId }, body: { deployToken: "deploy-token" } },
      { context },
    );
    const afterStop = await startApp(appIds[6]!);
    expect(afterStop.body.sessionId).toBeTruthy();
  });

  // PGlite uses one connection here; this checks the cap and error, not PostgreSQL row locking.
  it("enforces the scope cap when several starts are requested together", async () => {
    const appIds = Array.from(
      { length: 6 },
      (_, index) => `raceapp${String(index).padStart(5, "0")}`,
    );
    await db
      .insert(appTable)
      .values(
        appIds.map((publicId) => ({ projectId, publicId, name: publicId, scopeId: "author" })),
      );
    const results = await Promise.allSettled(
      appIds.map((appId) =>
        call(previewRouter.start, { body: { appId, deployToken: "deploy-token" } }, { context }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: "CONFLICT",
      message: "This scope already has 5 active previews.",
    });
  });
});
