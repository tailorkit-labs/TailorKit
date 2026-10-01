import { call } from "@orpc/server";
import { app as appTable, appDeployment, appDeploymentFile } from "@tailorkit/db/schema/apps";
import { organization } from "@tailorkit/db/schema/auth";
import { project as projectTable } from "@tailorkit/db/schema/project";
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

const { deploymentRouter, mapReturnedFilesByAssetPath } = await import("./deployments");
const { canonicalizeScope } = await import("../scope");

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const logoChecksum = "b".repeat(64);
const logoChecksumBase64 = Buffer.from(logoChecksum, "hex").toString("base64");
const productionScope = { name: "environment", value: { environment: "production" } };

describe("platform deployment uploads", () => {
  let client: Awaited<ReturnType<typeof createTestDb>>["client"];
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];

  beforeEach(async () => {
    const testDb = await createTestDb();
    client = testDb.client;
    db = testDb.db;
    testState.db = db;

    await db.insert(organization).values({
      createdAt: new Date(),
      id: organizationId,
      name: "Analytical Engines",
      publicId: "team0000000001",
      slug: "analytical-engines",
    });
    await db.insert(projectTable).values({
      createdAt: new Date(),
      id: projectId,
      name: "Compiler",
      organizationId,
      slug: "compiler",
      updatedAt: new Date(),
    });
    await db.insert(appTable).values({
      name: "Inbox",
      projectId,
      publicId: "app000000001",
      ...canonicalizeScope(productionScope),
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await client.close();
    vi.restoreAllMocks();
  });

  const createLogoDeployment = async () => {
    const currentApp = await db.query.app.findFirst();
    if (!currentApp) {
      throw new Error("Test app was not created.");
    }
    const [deployment] = await db
      .insert(appDeployment)
      .values({ appId: currentApp.id, publicId: "dep000000001", status: "uploading" })
      .returning();
    if (!deployment) {
      throw new Error("Test deployment was not created.");
    }
    await db.insert(appDeploymentFile).values({
      appDeploymentId: deployment.id,
      checksum: logoChecksum,
      contentLength: 11,
      contentType: "image/svg+xml",
      encoding: null,
      objectKey: "teams/team0000000001/logo-dark.svg",
    });
    return deployment;
  };

  const publishContext = (downloadUrl: string): Context => ({
    organization: {
      createdAt: new Date(),
      id: organizationId,
      logo: null,
      metadata: null,
      name: "Analytical Engines",
      publicId: "team0000000001",
      slug: "analytical-engines",
    },
    project: {
      createdAt: new Date(),
      id: projectId,
      name: "Compiler",
      organizationId,
      slug: "compiler",
      updatedAt: new Date(),
    },
    storage: {
      type: "s3",
      createDownloadUrl: vi.fn().mockResolvedValue({ url: downloadUrl }),
      createUploadUrl: vi.fn(),
      delete: vi.fn(),
      head: vi.fn().mockResolvedValue({
        checksumSha256: logoChecksumBase64,
        contentLength: 11,
        contentType: "image/svg+xml",
      }),
    },
  });

  it("hides a deployment when its app has a malformed stored scope", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deployment = await createLogoDeployment();
    await db
      .update(appTable)
      .set({ scope: { name: "environment", value: {} } })
      .where(eq(appTable.id, deployment.appId));
    await expect(
      call(
        deploymentRouter.get,
        { params: { deploymentId: deployment.id }, body: { scopes: [productionScope] } },
        { context: publishContext("https://uploads.example/logo-dark.svg") },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(warn).toHaveBeenCalledWith(
      "Deployment app has an invalid stored scope.",
      expect.objectContaining({ appId: deployment.appId, deploymentId: deployment.id }),
    );
  });

  it("hides a deployment when its stored scope key does not match its scope", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deployment = await createLogoDeployment();
    await db
      .update(appTable)
      .set({ scopeKey: "0".repeat(32) })
      .where(eq(appTable.id, deployment.appId));

    await expect(
      call(
        deploymentRouter.get,
        { params: { deploymentId: deployment.id }, body: { scopes: [productionScope] } },
        { context: publishContext("https://uploads.example/logo-dark.svg") },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(warn).toHaveBeenCalledWith(
      "Deployment app has an invalid stored scope.",
      expect.objectContaining({ appId: deployment.appId, deploymentId: deployment.id }),
    );
  });

  it("uploads client and private server code separately, verifies both, and resolves only published scoped code", async () => {
    const context = publishContext("https://private.example/server");
    const uploads = vi.fn(({ key }: { key: string }) =>
      Promise.resolve({ key, uploadUrl: `https://uploads.example/${key}` }),
    );
    context.storage.createUploadUrl = uploads;
    const currentApp = await db.query.app.findFirst();
    if (!currentApp) throw new Error("Missing app");
    const metadata = {
      checksum: logoChecksum,
      contentLength: 11,
      contentType: "application/javascript" as const,
      encoding: "utf-8" as const,
    };
    const created = await call(
      deploymentRouter.create,
      {
        body: {
          appId: currentApp.id,
          scope: productionScope,
          assets: [{ ...metadata, objectKey: "client.js" }],
          server: { ...metadata, objectKey: "server.js" },
        },
      },
      { context },
    );
    expect(created.body.assets[0]?.file.objectKey).toMatch(/\/client\/client\.js$/u);
    expect(created.body.server?.file.objectKey).toMatch(/\/server\/server\.js$/u);
    expect(uploads).toHaveBeenCalledTimes(2);
    const lookup = { params: { appId: currentApp.id }, body: { scope: productionScope } };
    await expect(call(deploymentRouter.server, lookup, { context })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(context.storage.createDownloadUrl).not.toHaveBeenCalled();
    context.storage.head = vi.fn().mockResolvedValue({
      checksumSha256: logoChecksumBase64,
      contentLength: 11,
      contentType: "application/javascript",
    });
    await call(
      deploymentRouter.publish,
      {
        params: { deploymentId: created.body.deployment.id },
        body: { scope: productionScope, rollout: true },
      },
      { context },
    );
    await expect(
      call(deploymentRouter.runtime, { params: lookup.params, body: {} }, { context }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const runtime = await call(
      deploymentRouter.runtime,
      { params: lookup.params, body: {} },
      { context: { ...context, runtimeService: true } },
    );
    await expect(
      call(
        deploymentRouter.runtime,
        { params: lookup.params, body: {} },
        {
          context: {
            ...context,
            runtimeService: true,
            project: { ...context.project, id: "33333333-3333-4333-8333-333333333333" },
          },
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(runtime.body).toEqual({
      projectId: context.project.id,
      appId: currentApp.id,
      deploymentId: created.body.deployment.id,
      objectKey: created.body.server?.file.objectKey,
      checksum: logoChecksum,
      contentLength: 11,
    });
    expect(context.storage.createDownloadUrl).not.toHaveBeenCalled();
    const resolved = await call(deploymentRouter.server, lookup, { context });
    expect(resolved.body).toEqual({
      url: "https://private.example/server",
      checksum: logoChecksum,
      contentLength: 11,
    });
    expect(context.storage.createDownloadUrl).toHaveBeenCalledWith({
      key: created.body.server?.file.objectKey,
      expiresInSeconds: 60,
    });
    await expect(
      call(
        deploymentRouter.server,
        { ...lookup, body: { scope: { name: "environment", value: { environment: "other" } } } },
        { context },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(context.storage.createDownloadUrl).toHaveBeenCalledOnce();
    const files = await db.query.appDeploymentFile.findMany({
      where: { appDeploymentId: created.body.deployment.id },
    });
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.status === "verified")).toBe(true);
  });

  it("maps reordered returned files using their generated file IDs", () => {
    const assets = [
      { asset: { objectKey: "client.js" }, fileId: "client-file-id" },
      { asset: { objectKey: `logos/${logoChecksum}.svg` }, fileId: "logo-file-id" },
    ];
    const returnedFiles = [
      { id: "logo-file-id", objectKey: "stored-logo" },
      { id: "client-file-id", objectKey: "stored-client" },
    ];

    const filesByAssetPath = mapReturnedFilesByAssetPath(assets, returnedFiles);

    expect(filesByAssetPath.get("client.js")?.id).toBe("client-file-id");
    expect(filesByAssetPath.get(`logos/${logoChecksum}.svg`)?.id).toBe("logo-file-id");
  });

  it("creates optional logo assets alongside the client bundle", async () => {
    const createUploadUrl = vi.fn(({ key }: { key: string }) =>
      Promise.resolve({
        key,
        uploadUrl: `https://uploads.example/${key}`,
      }),
    );
    const context = {
      organization: {
        createdAt: new Date(),
        id: organizationId,
        logo: null,
        metadata: null,
        name: "Analytical Engines",
        publicId: "team0000000001",
        slug: "analytical-engines",
      },
      project: {
        createdAt: new Date(),
        id: projectId,
        name: "Compiler",
        organizationId,
        slug: "compiler",
        updatedAt: new Date(),
      },
      storage: {
        type: "s3",
        createDownloadUrl: vi.fn(),
        createUploadUrl,
        delete: vi.fn(),
        head: vi.fn().mockRejectedValue({ name: "NoSuchKey" }),
      },
    } satisfies Context;

    const app = await db.query.app.findFirst();
    if (!app) {
      throw new Error("Test app was not created.");
    }

    const result = await call(
      deploymentRouter.create,
      {
        body: {
          appId: app.id,
          assets: [
            {
              checksum: "a".repeat(64),
              contentLength: 1_048_576,
              contentType: "application/javascript",
              encoding: "utf-8",
              objectKey: "client.js",
            },
          ],
          logos: {
            dark: {
              checksum: "b".repeat(64),
              contentLength: 262_144,
              contentType: "image/svg+xml",
            },
            light: {
              checksum: "b".repeat(64),
              contentLength: 262_144,
              contentType: "image/svg+xml",
            },
          },
          scope: productionScope,
        },
      },
      { context },
    );

    expect(result.body.assets).toHaveLength(1);
    expect(result.body.logos?.dark?.file.objectKey).toMatch(
      new RegExp(`/logos/${"b".repeat(64)}\\.svg$`, "u"),
    );
    expect(result.body.logos?.light?.file.id).toBe(result.body.logos?.dark?.file.id);
    expect(result.body.deployment).toEqual(
      expect.objectContaining({
        clientEntryFileId: expect.any(String),
        logoDarkFileId: expect.any(String),
        logoDarkPath: `logos/${"b".repeat(64)}.svg`,
        logoLightFileId: expect.any(String),
        logoLightPath: `logos/${"b".repeat(64)}.svg`,
      }),
    );
    expect(createUploadUrl).toHaveBeenCalledTimes(2);
  });

  it("reuses a matching app logo without creating another upload URL", async () => {
    const createUploadUrl = vi.fn(({ key }: { key: string }) =>
      Promise.resolve({ key, uploadUrl: `https://uploads.example/${key}` }),
    );
    const context = {
      organization: {
        createdAt: new Date(),
        id: organizationId,
        logo: null,
        metadata: null,
        name: "Analytical Engines",
        publicId: "team0000000001",
        slug: "analytical-engines",
      },
      project: {
        createdAt: new Date(),
        id: projectId,
        name: "Compiler",
        organizationId,
        slug: "compiler",
        updatedAt: new Date(),
      },
      storage: {
        type: "s3",
        createDownloadUrl: vi.fn(),
        createUploadUrl,
        delete: vi.fn(),
        head: vi.fn().mockResolvedValue({
          checksumSha256: logoChecksumBase64,
          contentLength: 262_144,
          contentType: "image/svg+xml",
        }),
      },
    } satisfies Context;
    const currentApp = await db.query.app.findFirst();
    if (!currentApp) {
      throw new Error("Test app was not created.");
    }

    const result = await call(
      deploymentRouter.create,
      {
        body: {
          appId: currentApp.id,
          assets: [
            {
              checksum: "a".repeat(64),
              contentLength: 1,
              contentType: "application/javascript",
              encoding: "utf-8",
              objectKey: "client.js",
            },
          ],
          logos: {
            dark: {
              checksum: logoChecksum,
              contentLength: 262_144,
              contentType: "image/svg+xml",
            },
          },
          scope: productionScope,
        },
      },
      { context },
    );

    expect(result.body.logos?.dark?.uploadUrl).toBeUndefined();
    expect(createUploadUrl).toHaveBeenCalledTimes(1);
    expect(context.storage.head).toHaveBeenCalledWith({
      key: `teams/team0000000001/projects/${projectId}/apps/app000000001/logos/${logoChecksum}.svg`,
    });
  });

  it("rejects the client assets array when it exceeds 1 MiB", async () => {
    const createUploadUrl = vi.fn();
    const context = {
      organization: {
        createdAt: new Date(),
        id: organizationId,
        logo: null,
        metadata: null,
        name: "Analytical Engines",
        publicId: "team0000000001",
        slug: "analytical-engines",
      },
      project: {
        createdAt: new Date(),
        id: projectId,
        name: "Compiler",
        organizationId,
        slug: "compiler",
        updatedAt: new Date(),
      },
      storage: {
        type: "s3",
        createDownloadUrl: vi.fn(),
        createUploadUrl,
        delete: vi.fn(),
        head: vi.fn(),
      },
    } satisfies Context;

    const app = await db.query.app.findFirst();
    if (!app) {
      throw new Error("Test app was not created.");
    }

    await expect(
      call(
        deploymentRouter.create,
        {
          body: {
            appId: app.id,
            assets: [
              {
                checksum: "a".repeat(64),
                contentLength: 1_048_577,
                contentType: "application/javascript",
                encoding: "utf-8",
                objectKey: "client.js",
              },
            ],
            scope: productionScope,
          },
        },
        { context },
      ),
    ).rejects.toThrow("Input validation failed");
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS logo inspection URLs before fetching", async () => {
    const deployment = await createLogoDeployment();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      call(
        deploymentRouter.publish,
        {
          body: { rollout: true, scope: productionScope },
          params: { deploymentId: deployment.id },
        },
        { context: publishContext("http://uploads.example/logo-dark.svg") },
      ),
    ).rejects.toThrow("Logo download URL must use HTTPS.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts logo inspection while reading the response body", async () => {
    const deployment = await createLogoDeployment();
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: URL, init?: RequestInit) =>
        Promise.resolve({
          arrayBuffer: () =>
            new Promise<ArrayBuffer>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              );
            }),
          ok: true,
        }),
      ),
    );

    const publish = call(
      deploymentRouter.publish,
      {
        body: { rollout: true, scope: productionScope },
        params: { deploymentId: deployment.id },
      },
      { context: publishContext("https://uploads.example/logo-dark.svg") },
    );
    const advanceTimers = vi.advanceTimersByTimeAsync(10_000);
    await expect(publish).rejects.toThrow("Aborted");
    await advanceTimers;
  });
});
