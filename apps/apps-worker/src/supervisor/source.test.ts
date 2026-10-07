import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { deploymentSource } from "./source";

const code = "export class AppFacet {}";
const deployment = {
  projectId: "project",
  appId: "app",
  deploymentId: "v1",
  objectKey: "private/server/server.js",
  checksum: [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code))),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(""),
  contentLength: code.length,
};

const identity = {
  ...deployment,
  installationId: "one",
  userId: "user",
  expiresAt: Date.now() + 120_000,
};

const setup = (contents: string | Uint8Array<ArrayBuffer> | null = code) => {
  const get = vi.fn(async () =>
    contents === null ? null : { body: new Response(contents).body! },
  );

  return {
    get,
    source: deploymentSource({
      PLATFORM_URL: "https://platform.test/api/platform",
      RUNTIME_SERVICE_TOKEN: "private",
      DEPLOYMENTS: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
      } as unknown as KVNamespace,
      BUNDLES: { get },
    }),
  };
};

afterEach(() => vi.restoreAllMocks());

it("resolves authorized metadata separately from R2 code and never follows redirects with credentials", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(deployment));
  const { source, get } = setup();

  expect(await Effect.runPromise(source.current(identity))).toEqual(deployment);
  expect(get).not.toHaveBeenCalled();
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    headers: { authorization: "Bearer private", "x-tailorkit-project-id": "project" },
    redirect: "manual",
  });

  expect(await Effect.runPromise(source.code(deployment))).toBe(code);
  expect(get).toHaveBeenCalledWith(deployment.objectKey);
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([null, "tampered", `${code} extra`])(
  "rejects missing, corrupted and oversized R2 code: %s",
  async (contents) => {
    expect((await Effect.runPromiseExit(setup(contents).source.code(deployment)))._tag).toBe(
      "Failure",
    );
  },
);

it.each([302, 403, 404, 503])("fails closed when platform metadata returns %s", async (status) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
  const { source, get } = setup();

  expect((await Effect.runPromiseExit(source.current(identity)))._tag).toBe("Failure");
  expect(get).not.toHaveBeenCalled();
});

it("serves KV hits to old clients and fills misses from the platform", async () => {
  const values = new Map<string, unknown>();
  const put = vi.fn(async (key: string, value: string) => {
    values.set(key, JSON.parse(value));
  });
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json({ ...deployment, deploymentId: "v2" }));
  const source = deploymentSource({
    PLATFORM_URL: "https://platform.test",
    RUNTIME_SERVICE_TOKEN: "private",
    BUNDLES: { get: vi.fn() },
    DEPLOYMENTS: {
      get: async (key: string) => values.get(key) ?? null,
      put,
    } as unknown as KVNamespace,
  });
  expect((await Effect.runPromise(source.current(identity))).deploymentId).toBe("v2");
  expect(put).toHaveBeenCalledOnce();
  expect((await Effect.runPromise(source.current(identity, "v2"))).deploymentId).toBe("v2");
  expect(fetch).toHaveBeenCalledOnce();
  values.set(JSON.stringify([identity.projectId, identity.appId]), deployment);
  // A stale replica must not cause a downgrade after v2 migrations ran.
  expect((await Effect.runPromise(source.current(identity, "v2"))).deploymentId).toBe("v2");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("verifies compressed server bytes before inflating and caches the decoded code", async () => {
  const bytes = gzipSync(code);
  const metadata = {
    ...deployment,
    contentEncoding: "gzip" as const,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    contentLength: bytes.byteLength,
  };
  const { source, get } = setup(bytes);
  expect(await Effect.runPromise(source.code(metadata))).toBe(code);
  expect(await Effect.runPromise(source.code(metadata))).toBe(code);
  expect(get).toHaveBeenCalledOnce();
  const tampered = { ...metadata, checksum: "a".repeat(64) };
  expect((await Effect.runPromiseExit(setup(bytes).source.code(tampered)))._tag).toBe("Failure");
  expect(
    (
      await Effect.runPromiseExit(
        setup(bytes).source.code({ ...metadata, contentLength: bytes.byteLength + 1 }),
      )
    )._tag,
  ).toBe("Failure");
});

it.each([Buffer.from("not gzip"), gzipSync("x".repeat(1024 * 1024 + 1))])(
  "rejects invalid gzip and inflated code exceeding the deployment limit",
  async (bytes) => {
    const metadata = {
      ...deployment,
      contentEncoding: "gzip" as const,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      contentLength: bytes.byteLength,
    };
    expect((await Effect.runPromiseExit(setup(bytes).source.code(metadata)))._tag).toBe("Failure");
  },
);
