import { testContract } from "../test-contract";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createTailorKitFetchClient } from "./fetch-client";
import { createTailorKitStore } from "../store/store";
import { createSlotStore } from "../store/fetch/slot";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("shares endpoint responses across roots without sharing local view registrations", async () => {
  const fetchMock = vi.fn((input) =>
    Promise.resolve(
      Response.json(String(input).endsWith("/apps") ? [{ id: "app" }] : { schema: { views: {} } }),
    ),
  );
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test/api", fetch: fetchMock });
  const first = createTailorKitStore({
    baseUrl: client.baseUrl,
    apps: undefined,
    client,
    contract: testContract(),
  });
  const second = createTailorKitStore({
    baseUrl: client.baseUrl,
    apps: undefined,
    client,
    contract: testContract(),
  });
  const stop = second.subscribeApps(vi.fn());
  await Promise.all([first.fetchApps(), second.fetchApps()]);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(second.getAppsSnapshot().apps).toBe(first.getAppsSnapshot().apps);
  first.views.register({ id: Symbol(), view: "/", context: {} });
  await Promise.resolve();
  expect(second.views.getSnapshot()).toBeNull();
  stop();
});

it("keeps supplied discovery data local while another root fetches", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json([{ id: "remote" }]));
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test/", fetch: fetchMock });
  const supplied = createTailorKitStore({
    baseUrl: client.baseUrl,
    apps: [{ id: "provided" }],
    client,
    contract: testContract(),
  });
  const remote = createTailorKitStore({
    baseUrl: client.baseUrl,
    apps: undefined,
    client,
    contract: testContract(),
  });
  await Promise.all([supplied.fetchApps(), remote.fetchApps()]);
  expect(supplied.getAppsSnapshot().apps).toEqual([{ id: "provided" }]);
  expect(remote.getAppsSnapshot().apps).toEqual([{ id: "remote" }]);
  await supplied.fetchApps({ force: true });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("honors app freshness defaults", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((input) =>
    Promise.resolve(
      Response.json(String(input).endsWith("/apps") ? [{ id: "app" }] : { schema: {} }),
    ),
  );
  const client = createTailorKitFetchClient({
    baseUrl: "https://host.test/",
    fetch: fetchMock,
    cache: { gcTime: Infinity, apps: { staleTime: 10 } },
  });
  await client.apps().fetch();
  vi.advanceTimersByTime(11);
  await client.apps().fetch();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await client.apps({ staleTime: Infinity }).fetch();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("isolates authenticated clients at the same endpoint and clears credentials with data", async () => {
  const firstFetch = vi.fn().mockResolvedValue(Response.json([{ id: "first" }]));
  const secondFetch = vi.fn().mockResolvedValue(Response.json([{ id: "second" }]));
  const first = createTailorKitFetchClient({ baseUrl: "https://host.test/", fetch: firstFetch });
  const second = createTailorKitFetchClient({ baseUrl: "https://host.test/", fetch: secondFetch });
  await first.apps().fetch();
  expect(second.apps().getSnapshot().status).toBe("idle");
  await second.apps().fetch();
  expect(second.apps().getSnapshot().data).toEqual([{ id: "second" }]);
  const provider = first.endpoints.getSessionProvider({ id: "app" });
  first.clear();
  expect(first.apps().getSnapshot().data).toBeUndefined();
  expect(first.endpoints.getSessionProvider({ id: "app" })).not.toBe(provider);
  expect(second.apps().getSnapshot().data).toEqual([{ id: "second" }]);
});

it("deduplicates instance requests and sessions across framework-neutral consumers", async () => {
  const fetchMock = vi.fn((input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/meta"))
      return Promise.resolve(
        Response.json({
          schema: {
            views: { "/": {} },
            slots: { page: { views: ["/"], multiple: true } },
          },
        }),
      );
    if (path.endsWith("/backend/session"))
      return Promise.resolve(
        Response.json({
          token: "token",
          url: "https://runtime.test/rpc",
          expiresAt: Date.now() + 300_000,
        }),
      );
    return Promise.resolve(Response.json({ json: [{ key: "overview", data: {}, metadata: {} }] }));
  });
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test/", fetch: fetchMock });
  const contract = testContract(true);
  const options = {
    apps: [{ id: "app", views: [{ slot: "page", path: "/", instances: true as const }] }],
    slot: "page",
    activeView: {
      view: "/",
      layers: [{ path: "/", context: { userId: "user" }, status: "ready" as const }],
    },
  };
  const first = createSlotStore(client, contract, options);
  const second = createSlotStore(client, contract, options);
  const stopFirst = first.subscribe(vi.fn());
  const stopSecond = second.subscribe(vi.fn());
  const pending = first.fetch();
  expect(second.fetch()).toBe(pending);
  await pending;
  expect(first.getSnapshot().data?.[0]).toMatchObject({ key: "overview" });
  expect(second.getSnapshot().data).toBe(first.getSnapshot().data);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  stopFirst();
  stopSecond();
});
