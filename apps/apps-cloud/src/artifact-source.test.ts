import { createHash } from "node:crypto";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { platformArtifacts } from "./artifact-source";
import type { StorageEnvironment } from "./env";

const code = "export class AppFacet {}";
const checksum = createHash("sha256").update(code).digest("hex");
const identity = {
  appId: "app-one",
  installationId: "installation",
  userId: "user",
  expiresAt: Date.now() + 120_000,
};
const configuration: Pick<StorageEnvironment, "PLATFORM_URL" | "PLATFORM_TOKEN" | "STORAGE_SCOPE"> =
  {
    PLATFORM_URL: "https://platform.example/api/platform",
    PLATFORM_TOKEN: "private-platform-key",
    STORAGE_SCOPE: JSON.stringify({ name: "environment", value: { environment: "production" } }),
  };
const metadata = (
  hash = checksum,
  size = code.length,
  url = "https://private.example/signed-server",
) => Response.json({ body: { url, checksum: hash, contentLength: size } });
const source = () => platformArtifacts(configuration as StorageEnvironment);
afterEach(() => vi.restoreAllMocks());

it("fetches only the verified app's published bundle using private credentials and verifies its hash", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(new Response(code));
  const artifact = await Effect.runPromise(source().get(identity));
  expect(artifact).toEqual({ code, codeHash: checksum });
  expect(String(fetch.mock.calls[0]?.[0])).toBe(
    "https://platform.example/api/platform/apps/app-one/server",
  );
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    headers: { authorization: "Bearer private-platform-key" },
    redirect: "error",
  });
  expect(fetch.mock.calls[1]?.[1]?.headers).toBeUndefined();
});

it("rechecks the published version but reuses verified code until the checksum changes", async () => {
  const secondCode = "export class AppFacet { fetch() {} }";
  const secondHash = createHash("sha256").update(secondCode).digest("hex");
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(new Response(code))
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(metadata(secondHash, secondCode.length))
    .mockResolvedValueOnce(new Response(secondCode));
  const artifacts = source();
  await Effect.runPromise(artifacts.get(identity));
  await Effect.runPromise(artifacts.get(identity));
  const changed = await Effect.runPromise(artifacts.get(identity));
  expect(changed.codeHash).toBe(secondHash);
  expect(fetch).toHaveBeenCalledTimes(5);
});

it.each([
  ["checksum mismatch", () => metadata("a".repeat(64)), code],
  ["oversized download", () => metadata(checksum, 1), code],
  ["truncated download", () => metadata(checksum, code.length + 1), code],
  [
    "insecure download",
    () => metadata(checksum, code.length, "http://private.example/server"),
    code,
  ],
] as const)("rejects %s before loading code", async (_name, response, contents) => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(new Response(contents));
  const exit = await Effect.runPromiseExit(source().get(identity));
  expect(exit._tag).toBe("Failure");
});

it("does not download code for an unpublished or unauthorized app", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  const exit = await Effect.runPromiseExit(source().get(identity));
  expect(exit._tag).toBe("Failure");
  expect(fetch).toHaveBeenCalledOnce();
});
