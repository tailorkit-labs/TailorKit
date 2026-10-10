import { expect, it, vi } from "vite-plus/test";
import { createSessionProvider } from "./session";

it("deduplicates token requests, caches until renewal and sends only the host-bound app ID", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
    Response.json({
      subjectId: "principal",
      token: "scoped",
      expiresAt: Date.now() + 300_000,
      url: "https://runtime.test/rpc",
    }),
  );
  const session = createSessionProvider({
    baseUrl: "https://host.test/api/tailorkit",
    appId: "allowed",
    subjectId: "principal",
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
it("renews cached sessions when one minute remains", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  try {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
      Response.json({
        subjectId: "principal",
        token: "scoped",
        expiresAt: Date.now() + 300_000,
        url: "https://runtime.test/rpc",
      }),
    );
    const session = createSessionProvider({
      baseUrl: "https://host.test/api",
      appId: "allowed",
      subjectId: "principal",
      fetch,
    });
    await session({ refresh: false });
    vi.setSystemTime(239_999);
    await session({ refresh: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(240_000);
    await session({ refresh: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
it("does not cache failed authorization or malformed sessions", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ token: "secret" }))
    .mockResolvedValueOnce(
      Response.json({
        subjectId: "principal",
        token: "scoped",
        expiresAt: Date.now() + 300_000,
        url: "https://runtime.test/rpc",
      }),
    );
  const session = createSessionProvider({
    baseUrl: "https://host.test/api",
    appId: "allowed",
    subjectId: "principal",
    fetch,
  });
  await expect(session({ refresh: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(session({ refresh: false })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(session({ refresh: false })).resolves.toMatchObject({ token: "scoped" });
});

it("reports session network failures as retryable and allows the next request to recover", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce(
      Response.json({
        subjectId: "principal",
        token: "scoped",
        expiresAt: Date.now() + 300_000,
        url: "https://runtime.test/rpc",
      }),
    );
  const session = createSessionProvider({
    baseUrl: "https://host.test/api",
    appId: "allowed",
    subjectId: "principal",
    fetch,
  });
  await expect(session({ refresh: false })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(session({ refresh: false })).resolves.toMatchObject({ token: "scoped" });
});
it("requests credentials afresh without a cache principal and rejects a mismatched authenticated subject", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
    Response.json({
      token: "scoped",
      expiresAt: Date.now() + 300_000,
      url: "https://runtime.test/rpc",
      subjectId: "actual",
    }),
  );
  const anonymousCache = createSessionProvider({
    baseUrl: "https://product.test/api/",
    appId: "app",
    fetch,
  });
  await anonymousCache({ refresh: false });
  await anonymousCache({ refresh: false });
  expect(fetch).toHaveBeenCalledTimes(2);
  const subjectCache = createSessionProvider({
    baseUrl: "https://product.test/api/",
    appId: "app",
    subjectId: "different",
    fetch,
  });
  await expect(subjectCache({ refresh: false })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
