import { Effect } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { deploymentSource, installationName } from "./source";
import { afterEach } from "vite-plus/test";
afterEach(() => vi.restoreAllMocks());

const identity = {
  subjectId: "user",
  projectId: "project",
  scope: { name: "org", value: { id: "tenant" } },
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
  appId: "app",
  installationId: "installation",
  deploymentId: "v1",
  expiresAt: Date.now() + 120_000,
};

const deployment = {
  projectId: "project",
  scope: { name: "org", value: { id: "tenant" } },
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
  appId: "app",
  deploymentId: "v1",
  objectKey: "private/server.js",
  checksum: "a".repeat(64),
  contentLength: 1,
};

it.each([
  ["projectId", "other", "FORBIDDEN"],
  ["appId", "other", "FORBIDDEN"],
] as const)("rejects mismatched %s before downloading code", async (field, value, code) => {
  const load = vi.fn();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ...deployment, [field]: value }));
  const source = deploymentSource({
    PLATFORM_URL: "https://platform.test",
    RUNTIME_SERVICE_TOKEN: "private",
    DEPLOYMENTS: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
    } as unknown as KVNamespace,
    BUNDLES: { get: load },
  });
  const result = await Effect.runPromise(
    source.current(identity).pipe(Effect.catch((error) => Effect.succeed(error.code))),
  );
  expect(result).toBe(code);
  expect(load).not.toHaveBeenCalled();
});

it("rejects a token that expires while resolving deployment", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(deployment));
  const source = deploymentSource({
    PLATFORM_URL: "https://platform.test",
    RUNTIME_SERVICE_TOKEN: "private",
    DEPLOYMENTS: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
    } as unknown as KVNamespace,
    BUNDLES: { get: vi.fn() },
  });
  const result = await Effect.runPromise(
    source
      .current({ ...identity, expiresAt: 0 })
      .pipe(Effect.catch((error) => Effect.succeed(error.code))),
  );
  expect(result).toBe("UNAUTHORIZED");
});

it("routes code versions to the same storage but separates hosts, projects, apps and installations", () => {
  const name = installationName(identity, "host");

  expect(installationName({ ...identity, deploymentId: "v2" }, "host")).toBe(name);

  for (const key of ["projectId", "appId", "installationId"] as const)
    expect(installationName({ ...identity, [key]: "other" }, "host")).not.toBe(name);

  expect(installationName(identity, "other")).not.toBe(name);
});
