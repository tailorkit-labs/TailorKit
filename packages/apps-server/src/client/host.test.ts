import { expect, it, vi } from "vite-plus/test";
import { createSessionProvider } from "./host";

it("deduplicates token requests, caches until renewal and sends only the host-bound app ID", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
    Response.json({
      token: "scoped",
      expiresAt: Date.now() + 120_000,
      url: "https://runtime.test/rpc",
    }),
  );
  const session = createSessionProvider({
    baseUrl: "https://host.test/api/tailorkit",
    appId: "allowed",
    fetch,
  });
  const [first, second] = await Promise.all([
    session({ refresh: false }),
    session({ refresh: false }),
  ]);
  expect(first).toEqual(second);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0].toString()).toBe(
    "https://host.test/api/tailorkit/backend/session",
  );
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    credentials: "same-origin",
    body: JSON.stringify({ appId: "allowed" }),
  });
  await session({ refresh: false });
  expect(fetch).toHaveBeenCalledTimes(1);
  await session({ refresh: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not cache failed authorization or malformed sessions", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ token: "secret" }))
    .mockResolvedValueOnce(
      Response.json({
        token: "scoped",
        expiresAt: Date.now() + 120_000,
        url: "https://runtime.test/rpc",
      }),
    );
  const session = createSessionProvider({
    baseUrl: "https://host.test/api",
    appId: "allowed",
    fetch,
  });
  await expect(session({ refresh: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(session({ refresh: false })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(session({ refresh: false })).resolves.toMatchObject({ token: "scoped" });
});
