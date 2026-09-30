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
const setup = (contents: string | null = code) => {
  const get = vi.fn(async () =>
    contents === null ? null : { body: new Response(contents).body! },
  );
  return {
    get,
    source: deploymentSource({
      PLATFORM_URL: "https://platform.test/api/platform",
      PLATFORM_TOKEN: "private",
      STORAGE_SCOPE: "{}",
      BUNDLES: { get },
    }),
  };
};
afterEach(() => vi.restoreAllMocks());
it("resolves authorized metadata separately from R2 code and never follows redirects with credentials", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ body: deployment }));
  const { source, get } = setup();
  expect(await Effect.runPromise(source.current(identity))).toEqual(deployment);
  expect(get).not.toHaveBeenCalled();
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    headers: { authorization: "Bearer private" },
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
