import { afterEach, expect, it, vi } from "vite-plus/test";
import { createTailorKitFetchClient } from "./fetch-client";
import { createTailorKitStore } from "../store/store";
import { createSlotInstancesStore } from "../store/fetch/slot-instances";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("shares endpoint responses across roots without sharing local view registrations", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json([{ id: "app" }]));
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test/api", fetch: fetchMock });
  const first = createTailorKitStore(client.baseUrl, undefined, client);
  const second = createTailorKitStore(client.baseUrl, undefined, client);
  const stop = second.subscribeApps(vi.fn());
  await Promise.all([first.fetchApps(), second.fetchApps()]);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(second.getAppsSnapshot().apps).toBe(first.getAppsSnapshot().apps);
  first.views.register({ id: Symbol(), view: "/", context: {}, status: "ready" });
  await Promise.resolve();
  expect(second.views.getSnapshot()).toBeNull();
  stop();
});

it("keeps supplied discovery data local while another root fetches", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json([{ id: "remote" }]));
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test/", fetch: fetchMock });
  const supplied = createTailorKitStore(client.baseUrl, [{ id: "provided" }], client);
  const remote = createTailorKitStore(client.baseUrl, undefined, client);
  await Promise.all([supplied.fetchApps(), remote.fetchApps()]);
  expect(supplied.getAppsSnapshot().apps).toEqual([{ id: "provided" }]);
  expect(remote.getAppsSnapshot().apps).toEqual([{ id: "remote" }]);
  await supplied.fetchApps({ force: true });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("honors independent app and metadata freshness defaults", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((input) =>
    Promise.resolve(
      Response.json(String(input).endsWith("/apps") ? [{ id: "app" }] : { schema: {} }),
    ),
  );
  const client = createTailorKitFetchClient({
    baseUrl: "https://host.test/",
    fetch: fetchMock,
    cache: { gcTime: Infinity, apps: { staleTime: 10 }, meta: { staleTime: Infinity } },
  });
  await client.apps().fetch();
  await client.meta().fetch();
  vi.advanceTimersByTime(11);
  await client.apps().fetch();
  await client.meta().fetch();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await client.apps({ staleTime: Infinity }).fetch();
  expect(fetchMock).toHaveBeenCalledTimes(3);
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
            slots: { page: { views: ["/"] } },
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
  const options = {
    app: { id: "app", views: [{ slot: "page", path: "/", instances: true as const }] },
    slot: "page",
    activeView: {
      view: "/",
      layers: [{ path: "/", context: { userId: "user" }, status: "ready" as const }],
    },
  };
  const first = createSlotInstancesStore(client, options);
  const second = createSlotInstancesStore(client, options);
  const stopFirst = first.subscribe(vi.fn());
  const stopSecond = second.subscribe(vi.fn());
  const pending = first.fetch();
  expect(second.fetch()).toBe(pending);
  await pending;
  expect(first.getSnapshot().data?.[0]?.key).toBe("overview");
  expect(second.getSnapshot().data).toBe(first.getSnapshot().data);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  stopFirst();
  stopSecond();
});
