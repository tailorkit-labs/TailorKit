import { beforeEach, expect, it, vi } from "vite-plus/test";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import type { Context } from "../context";

const state = vi.hoisted(() => ({
  findApp: vi.fn(),
  findFile: vi.fn(),
  env: {
    APP_RUNTIME_INTERNAL_URL: "https://internal.tailorkit.app",
    APP_RUNTIME_SERVICE_TOKEN: "x".repeat(32),
  },
  publicKeys: vi.fn(() => ({
    keys: [{ kty: "EC", crv: "P-256", kid: "platform", x: "x", y: "y" }],
  })),
}));

vi.mock("../env", () => ({ env: state.env }));
vi.mock("@tailorkit/db", () => ({
  db: {
    query: {
      app: { findFirst: state.findApp },
      appDeploymentFile: { findFirst: state.findFile },
    },
  },
}));
vi.mock("@tailorkit/kv", () => ({ getKV: () => undefined }));
vi.mock("../runtime/auth", () => ({
  appRuntimePublicKeys: state.publicKeys,
  issueAppRuntimeToken: vi.fn(),
}));

import { getRuntimeBundle, handlePublicRuntimeRequest, publishRuntimeMetadata } from "./runtime";

beforeEach(() => vi.clearAllMocks());

it("serves public signing keys at the existing URL without an authenticated context", async () => {
  const response = handlePublicRuntimeRequest(
    new Request("https://platform.test/api/platform/runtime/keys"),
  );
  expect(response?.status).toBe(200);
  expect(response?.headers.get("cache-control")).toBe("public, max-age=60");
  await expect(response?.json()).resolves.toEqual(state.publicKeys());
});

it.each([
  ["GET", "/api/platform/apps/app/runtime/session"],
  ["POST", "/api/platform/runtime/keys"],
])("leaves %s %s for authenticated route handling", (method, path) => {
  expect(
    handlePublicRuntimeRequest(new Request(`https://platform.test${path}`, { method })),
  ).toBeUndefined();
  expect(state.publicKeys).not.toHaveBeenCalled();
});

it("returns a non-cacheable error when signing keys are unavailable", () => {
  state.publicKeys.mockImplementationOnce(() => {
    throw new Error("Private configuration details");
  });
  const response = handlePublicRuntimeRequest(
    new Request("https://platform.test/api/platform/runtime/keys"),
  );
  expect(response?.status).toBe(503);
  expect(response?.headers.get("cache-control")).toBe("no-store");
});

it("publishes deployment metadata to the worker with the service credential", async () => {
  const metadata = {
    projectId: "project",
    appId: "app",
    deploymentId: "v2",
    objectKey: "private/server.js",
    checksum: "a".repeat(64),
    contentLength: 10,
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 204 }));
  try {
    await publishRuntimeMetadata(metadata, "app000000001");
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://internal.tailorkit.app/p/project/a/app000000001/new-deployment"),
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: `Bearer ${state.env.APP_RUNTIME_SERVICE_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(metadata),
        redirect: "error",
      }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetch.mockRejectedValueOnce(new Error("Network unavailable"));
    await expect(publishRuntimeMetadata(metadata, "app000000001")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  } finally {
    fetch.mockRestore();
  }
});

it("returns deployment metadata directly as the HTTP response body", async () => {
  const metadata = {
    projectId: "project",
    appId: "app",
    deploymentId: "deployment",
    objectKey:
      "teams/team/projects/project/apps/app-public/deployments/deployment-public/server/server.js",
    checksum: "a".repeat(64),
    contentLength: 123,
  };
  state.findApp.mockResolvedValueOnce({
    id: metadata.appId,
    publicId: "app-public",
    currentDeployment: { id: metadata.deploymentId, publicId: "deployment-public" },
  });
  state.findFile.mockResolvedValueOnce(metadata);
  const handler = new OpenAPIHandler({ runtime: getRuntimeBundle });
  const { matched, response } = await handler.handle(
    new Request("https://platform.test/api/platform/apps/app/runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    {
      prefix: "/api/platform",
      context: {
        runtimeService: true,
        project: { id: metadata.projectId },
        organization: { id: "organization", publicId: "team" },
      } as Context,
    },
  );
  expect(matched).toBe(true);
  expect(response?.status).toBe(200);
  await expect(response?.json()).resolves.toEqual(metadata);
});
