import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  env: {
    APP_RUNTIME_INTERNAL_URL: "https://internal.tailorkit.app",
    APP_RUNTIME_SERVICE_TOKEN: "x".repeat(32),
  },
  publicKeys: vi.fn(() => ({
    keys: [{ kty: "EC", crv: "P-256", kid: "platform", x: "x", y: "y" }],
  })),
}));

vi.mock("../env", () => ({ env: state.env }));
vi.mock("@tailorkit/db", () => ({ db: {} }));
vi.mock("@tailorkit/kv", () => ({ getKV: () => undefined }));
vi.mock("../runtime/auth", () => ({
  appRuntimePublicKeys: state.publicKeys,
  issueAppRuntimeToken: vi.fn(),
}));

import { handlePublicRuntimeRequest, publishRuntimeMetadata } from "./runtime";

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
